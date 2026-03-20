/**
 * MiniMax TTS API Test Script
 *
 * Tests:
 * 1. REST TTS (synchronous audio generation)
 * 2. Voice list (POST)
 * 3. WebSocket streaming TTS (real-time audio generation)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve(__dirname, "../.env");
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
  const startTime = Date.now();

  const resp = await fetch(`${BASE_URL}/v1/t2a_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-2.8-turbo",
      text: "你好，这是一段测试语音。真正的危险不是计算机开始像人一样思考，而是人开始像计算机一样思考。",
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
    }),
  });

  const elapsed = Date.now() - startTime;
  const json = await resp.json();
  console.log("HTTP status:", resp.status);
  console.log("API status:", json.base_resp?.status_code);
  console.log("API msg:", json.base_resp?.status_msg);
  console.log("Latency:", elapsed + "ms");

  if (json.data?.audio) {
    const audioBuf = Buffer.from(json.data.audio, "hex");
    console.log("Audio size:", audioBuf.length, "bytes");
    const nonZero = audioBuf.some((b) => b !== 0);
    console.log("Has real audio:", nonZero);
    if (nonZero) {
      const outPath = resolve(__dirname, "../test-output-rest.pcm");
      writeFileSync(outPath, audioBuf);
      console.log("Saved to:", outPath);
    }
    return nonZero;
  }
  return false;
}

// ---------- Test 2: Voice List (POST) ----------
async function testVoiceList() {
  console.log("\n=== Test 2: Voice List ===");
  const resp = await fetch(`${BASE_URL}/v1/get_voice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice_type: "system" }),
  });

  const text = await resp.text();
  console.log("HTTP status:", resp.status);

  try {
    const json = JSON.parse(text);
    console.log("API status:", json.base_resp?.status_code);
    console.log("API msg:", json.base_resp?.status_msg);

    if (json.system_voice) {
      console.log("Voice count:", json.system_voice.length);
      for (const v of json.system_voice.slice(0, 10)) {
        console.log(`  - ${v.voice_id}: ${v.voice_name} (${v.gender || "?"})`);
      }
      return true;
    }
  } catch {
    console.log("Response (first 300 chars):", text.slice(0, 300));
  }
  return false;
}

// ---------- Test 3: WebSocket Streaming TTS ----------
async function testWebSocketTTS() {
  console.log("\n=== Test 3: WebSocket Streaming TTS ===");

  let WebSocket;
  try {
    const ws = await import("ws");
    WebSocket = ws.WebSocket || ws.default;
  } catch {
    WebSocket = globalThis.WebSocket;
    if (!WebSocket) {
      console.error("No WebSocket implementation available");
      return false;
    }
  }

  const ws = new WebSocket(WS_URL, undefined, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  return new Promise((resolve) => {
    const chunks = [];
    let startTime = 0;
    let firstChunkTime = 0;

    ws.on("open", () => console.log("WS connected"));

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const now = Date.now();

      if (msg.event === "connected_success") {
        console.log("Server acknowledged connection");
        startTime = now;
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
        console.log("Task started, sending text...");
        ws.send(
          JSON.stringify({
            event: "task_continue",
            text: "你好，这是一段流式测试语音。真正的危险不是计算机开始像人一样思考，而是人开始像计算机一样思考。",
          })
        );
      }

      if (msg.data?.audio) {
        if (!firstChunkTime) firstChunkTime = now;
        const buf = Buffer.from(msg.data.audio, "hex");
        chunks.push(buf);
        const total = chunks.reduce((a, c) => a + c.length, 0);
        console.log(
          `  chunk #${chunks.length}: ${buf.length} bytes (total: ${total}, TTFB: ${now - startTime}ms)`
        );
      }

      if (msg.is_final) {
        const total = Buffer.concat(chunks);
        const outPath = resolve(__dirname, "../test-output-ws.pcm");
        writeFileSync(outPath, total);
        console.log(`\nTotal: ${total.length} bytes in ${chunks.length} chunks`);
        console.log(`TTFB (first chunk): ${firstChunkTime - startTime}ms`);
        console.log(`Total time: ${now - startTime}ms`);
        console.log("Saved to:", outPath);

        const nonZero = total.some((b) => b !== 0);
        console.log("Has real audio:", nonZero);

        ws.send(JSON.stringify({ event: "task_finish" }));
        ws.close();
        resolve(nonZero);
      }
    });

    ws.on("error", (err) => {
      console.error("WS error:", err.message);
      resolve(false);
    });

    setTimeout(() => {
      console.error("WS timeout (20s)");
      ws.close();
      resolve(false);
    }, 20000);
  });
}

// ---------- Main ----------
async function main() {
  console.log("MiniMax TTS API Test");
  console.log("API Key:", API_KEY.slice(0, 10) + "...");
  console.log("Time:", new Date().toISOString());

  const restOk = await testRestTTS();
  const voiceOk = await testVoiceList();
  const wsOk = await testWebSocketTTS();

  console.log("\n=== Results ===");
  console.log("REST TTS:", restOk ? "PASS" : "FAIL");
  console.log("Voice List:", voiceOk ? "PASS" : "FAIL");
  console.log("WebSocket TTS:", wsOk ? "PASS" : "FAIL");
}

main().catch(console.error);
