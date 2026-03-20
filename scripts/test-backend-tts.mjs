/**
 * Test backend TTS pipeline integration with real MiniMax API.
 * Runs the same synthesize() function the backend uses.
 */

import { readFileSync } from "node:fs";
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

// Import the minimax-tts package directly (same as backend uses)
const { MiniMaxTTS } = await import("@clawer/minimax-tts");

const client = MiniMaxTTS.create({ apiKey: API_KEY });

console.log("Client type:", client.constructor.name);
console.log("API Key:", API_KEY.slice(0, 10) + "...");

// Test 1: WebSocket streaming TTS (what backend uses)
console.log("\n=== WebSocket Streaming TTS ===");
const startTime = Date.now();
let totalBytes = 0;
let chunkCount = 0;
let firstChunkTime = 0;

const text = "你好，这是一段来自后端 TTS pipeline 的测试语音。今天天气真不错。";

for await (const chunk of client.synthesizeWebSocket(text, {
  voiceId: "female-shaonv",
  speed: 1.0,
  volume: 1.0,
  pitch: 0,
})) {
  if (!firstChunkTime) firstChunkTime = Date.now();
  chunkCount++;
  totalBytes += chunk.length;
  if (chunkCount <= 5 || chunkCount % 50 === 0) {
    console.log(`  chunk #${chunkCount}: ${chunk.length} bytes (TTFB: ${firstChunkTime - startTime}ms)`);
  }
}

const elapsed = Date.now() - startTime;
console.log(`\nTotal: ${totalBytes} bytes in ${chunkCount} chunks`);
console.log(`TTFB: ${firstChunkTime - startTime}ms`);
console.log(`Total time: ${elapsed}ms`);

// Test 2: List voices
console.log("\n=== Voice List ===");
const voices = await client.listVoices();
console.log(`Found ${voices.length} voices`);
const sampleVoices = voices.slice(0, 15);
for (const v of sampleVoices) {
  console.log(`  ${v.voiceId} - ${v.name} (${v.gender})`);
}

// Test 3: Different voices
console.log("\n=== Different Voice Test ===");
const testVoices = ["female-shaonv", "male-qn-qingse", "female-yujie"];
for (const voiceId of testVoices) {
  const t0 = Date.now();
  let bytes = 0;
  for await (const chunk of client.synthesizeWebSocket("测试语音。", { voiceId })) {
    bytes += chunk.length;
  }
  console.log(`  ${voiceId}: ${bytes} bytes in ${Date.now() - t0}ms`);
}

console.log("\n=== All tests passed ===");
