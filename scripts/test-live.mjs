/**
 * Live test: start backend, connect via WS, send message, verify TTS audio comes back.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
try {
  const envContent = readFileSync(resolve(__dirname, "../.env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (val) process.env[key] = val;
    }
  }
} catch {}

const BASE = "http://localhost:3001";

async function main() {
  // 1. Health check
  console.log("=== Health Check ===");
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log("Status:", health.status);
  console.log("Mock openclaw:", health.mock?.openclaw);
  console.log("Mock minimax:", health.mock?.minimax);

  // 2. Create session
  console.log("\n=== Create Session ===");
  const sessResp = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "default" }),
  }).then((r) => r.json());
  console.log("Session:", sessResp.sessionId);

  // 3. Connect WebSocket
  console.log("\n=== WebSocket Connect ===");
  const wsUrl = `ws://localhost:3001/ws?sessionId=${sessResp.sessionId}`;
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
  console.log("Connected");

  // 4. Wait for connect event
  await new Promise((resolve) => {
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      console.log("Server event:", msg.event, JSON.stringify(msg.data));
      resolve();
    });
  });

  // 5. Send user message and collect responses
  console.log("\n=== Send Message ===");
  const messages = [];
  let textChunks = [];
  let audioChunks = [];
  let audioMeta = null;
  let gotFinalText = false;
  let gotFinalAudio = false;

  const msgPromise = new Promise((resolve) => {
    ws.on("message", (data, isBinary) => {
      // Binary = audio frame
      if (isBinary) {
        const seqId = data.readUInt32BE(0);
        const flags = data.readUInt8(4);
        const isFinal = (flags & 1) !== 0;
        const audioData = data.slice(5);
        audioChunks.push({ seqId, size: audioData.length, isFinal });
        if (isFinal) gotFinalAudio = true;
        return;
      }

      // Text = JSON event
      const msg = JSON.parse(data.toString());
      messages.push(msg);

      if (msg.event === "text_chunk") {
        textChunks.push(msg.data);
        if (msg.data.isFinal) gotFinalText = true;
      } else if (msg.event === "audio_meta") {
        audioMeta = msg.data;
      } else if (msg.event === "agent_status") {
        console.log(`  agent_status: ${msg.data.status}`);
      } else if (msg.event === "pong") {
        // ignore
      } else {
        console.log(`  event: ${msg.event}`, JSON.stringify(msg.data).slice(0, 100));
      }

      if (gotFinalText && gotFinalAudio) resolve();
    });
    setTimeout(resolve, 30000); // 30s timeout
  });

  ws.send(
    JSON.stringify({
      event: "user_message",
      data: {
        text: "你好，请介绍一下你自己",
        sessionId: sessResp.sessionId,
      },
    })
  );
  console.log("Sent: 你好，请介绍一下你自己");

  await msgPromise;

  // 6. Report results
  console.log("\n=== Results ===");
  const fullText = textChunks.map((c) => c.text).join("");
  console.log("Agent reply:", fullText.slice(0, 200) + (fullText.length > 200 ? "..." : ""));
  console.log("Text chunks:", textChunks.length);
  console.log("Audio meta:", audioMeta ? JSON.stringify(audioMeta) : "NOT RECEIVED");
  console.log("Audio frames:", audioChunks.length);

  const totalAudioBytes = audioChunks.reduce((sum, c) => sum + c.size, 0);
  console.log("Total audio bytes:", totalAudioBytes);

  if (totalAudioBytes > 0) {
    const nonZero = audioChunks.some((c) => c.size > 0);
    console.log("Has real audio data:", nonZero);
  }

  console.log("\n=== Verdict ===");
  if (fullText.length > 0 && audioChunks.length > 0) {
    console.log("PASS: Text streaming + TTS audio both working!");
  } else if (fullText.length > 0) {
    console.log("PARTIAL: Text works, but no audio received");
  } else {
    console.log("FAIL: No text or audio received");
  }

  ws.close();
}

main().catch(console.error);
