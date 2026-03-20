/**
 * MiniMax TTS API Test Script
 *
 * Tests:
 * 1. WebSocket streaming TTS (real-time audio generation)
 * 2. REST TTS (synchronous audio generation)
 * 3. Voice list
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env manually
const envPath = resolve(import.meta.dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf-8");
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

const API_KEY = process.env.MINIMAX_API_KEY;
if (!API_KEY) {
  console.error("MINIMAX_API_KEY not set");
  process.exit(1);
}

const BASE_URL = "https://api.minimaxi.com";
const WS_URL = "wss://api.minimaxi.com/ws/v1/t2a_v2";

// ---------- Test 1: REST TTS ----------
async function testRestTTS() {
  console.log("\n=== Test 1: REST TTS ===");
  const resp = await fetch(`${BASE_URL}/v1/t2a_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-2.8-turbo",
      text: "你好，这是一段测试语音。",
      voice_id: "female-shaonv",
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    }),
  });

  const json = (await resp.json()) as any;
  console.log("Status code:", json.base_resp?.status_code);
  console.log("Status msg:", json.base_resp?.status_msg);

  if (json.data?.audio) {
    const audioBuf = Buffer.from(json.data.audio, "hex");
    console.log("Audio size:", audioBuf.length, "bytes");
    // Save to file
    const outPath = resolve(import.meta.dirname, "../test-output-rest.pcm");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, audioBuf);
    console.log("Saved to:", outPath);
    return true;
  }
  return false;
}

// ---------- Test 2: Voice List ----------
async function testVoiceList() {
  console.log("\n=== Test 2: Voice List ===");
  // Try without GroupId first
  const resp = await fetch(`${BASE_URL}/v1/get_voice`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  const json = (await resp.json()) as any;
  console.log("Status code:", json.base_resp?.status_code);
  console.log("Status msg:", json.base_resp?.status_msg);

  if (json.system_voice) {
    console.log("Voice count:", json.system_voice.length);
    for (const v of json.system_voice.slice(0, 5)) {
      console.log(`  - ${v.voice_id}: ${v.voice_name} (${v.gender})`);
    }
    return true;
  }
  return false;
}

// ---------- Test 3: WebSocket Streaming TTS ----------
async function testWebSocketTTS() {
  console.log("\n=== Test 3: WebSocket Streaming TTS ===");

  const { WebSocket } = await import("ws");
  const ws = new WebSocket(WS_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  return new Promise<boolean>((resolve) => {
    const chunks: Buffer[] = [];
    let timeout: ReturnType<typeof setTimeout>;

    ws.on("open", () => console.log("WS connected"));

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      console.log("WS event:", msg.event || "(data)");

      if (msg.event === "connected_success") {
        ws.send(
          JSON.stringify({
            event: "task_start",
            model: "speech-2.8-turbo",
            voice_setting: {
              voice_id: "female-shaonv",
              speed: 1,
              vol: 1,
              pitch: 0,
            },
            audio_setting: {
              sample_rate: 24000,
              bitrate: 64000,
              format: "pcm",
              channel: 1,
            },
          })
        );
      } else if (msg.event === "task_started") {
        ws.send(
          JSON.stringify({
            event: "task_continue",
            text: "你好，这是一段流式测试语音。真正的危险不是计算机开始像人一样思考，而是人开始像计算机一样思考。",
          })
        );
      }

      if (msg.data?.audio) {
        const buf = Buffer.from(msg.data.audio, "hex");
        chunks.push(buf);
        console.log(`  chunk: ${buf.length} bytes (total: ${chunks.reduce((a, c) => a + c.length, 0)})`);
      }

      if (msg.is_final) {
        const total = Buffer.concat(chunks);
        const { writeFileSync } = require("node:fs");
        const outPath = resolve(import.meta.dirname, "../test-output-ws.pcm");
        writeFileSync(outPath, total);
        console.log("Total audio:", total.length, "bytes");
        console.log("Saved to:", outPath);

        ws.send(JSON.stringify({ event: "task_finish" }));
        ws.close();
        clearTimeout(timeout);
        resolve(true);
      }
    });

    ws.on("error", (err: Error) => {
      console.error("WS error:", err.message);
      clearTimeout(timeout);
      resolve(false);
    });

    timeout = setTimeout(() => {
      console.error("WS timeout");
      ws.close();
      resolve(false);
    }, 20000);
  });
}

// ---------- Main ----------
async function main() {
  console.log("MiniMax TTS API Test");
  console.log("API Key:", API_KEY!.slice(0, 10) + "...");

  const restOk = await testRestTTS();
  const voiceOk = await testVoiceList();
  const wsOk = await testWebSocketTTS();

  console.log("\n=== Results ===");
  console.log("REST TTS:", restOk ? "PASS" : "FAIL");
  console.log("Voice List:", voiceOk ? "PASS" : "FAIL");
  console.log("WebSocket TTS:", wsOk ? "PASS" : "FAIL");
}

main().catch(console.error);
