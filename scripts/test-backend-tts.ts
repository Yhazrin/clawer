/**
 * Test: backend TTS pipeline with real MiniMax WebSocket API
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
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

// Import from source (node --experimental-strip-types handles .ts)
const { MiniMaxTTS } = await import("../packages/minimax-tts/src/index.ts");

const client = MiniMaxTTS.create({ apiKey: process.env.MINIMAX_API_KEY! });
console.log("Client type:", client.constructor.name);

// Test 1: WebSocket streaming (what backend uses)
console.log("\n=== WebSocket Streaming TTS ===");
const t0 = Date.now();
let totalBytes = 0;
let chunks = 0;
let ttfb = 0;

for await (const chunk of client.synthesizeWebSocket("你好，这是一段测试语音。今天天气真不错。", {
  voiceId: "female-shaonv",
  speed: 1.0,
  volume: 1.0,
  pitch: 0,
})) {
  if (!ttfb) ttfb = Date.now() - t0;
  chunks++;
  totalBytes += chunk.length;
}
console.log(`Total: ${totalBytes} bytes, ${chunks} chunks, TTFB: ${ttfb}ms, time: ${Date.now() - t0}ms`);

// Test 2: Voice list
console.log("\n=== Voice List ===");
const voices = await client.listVoices();
console.log(`Total: ${voices.length} voices`);
for (const v of voices.slice(0, 10)) {
  console.log(`  ${v.voiceId} - ${v.name} (${v.gender})`);
}

// Test 3: Different voices
console.log("\n=== Multi-voice Test ===");
for (const vid of ["female-shaonv", "male-qn-qingse", "female-yujie", "male-qn-badao"]) {
  const start = Date.now();
  let bytes = 0;
  for await (const c of client.synthesizeWebSocket("测试语音。", { voiceId: vid })) {
    bytes += c.length;
  }
  console.log(`  ${vid}: ${bytes} bytes, ${Date.now() - start}ms`);
}

console.log("\nAll tests passed!");
