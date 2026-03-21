/**
 * TTS Pipeline — MiniMax 语音合成接入层。
 *
 * Mock 模式（默认）：当 MINIMAX_API_KEY 未设置时，生成静音 PCM 数据。
 * 真实模式：通过 MiniMax WebSocket 流式合成，逐块返回音频。
 */

import { MiniMaxTTS } from "@clawer/minimax-tts";

// Lazy check — dotenv may not be loaded when this module is first imported
function isMockMode(): boolean {
  return !process.env.MINIMAX_API_KEY;
}

// Default audio spec: PCM 16-bit, 24000 Hz, mono
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // 16-bit = 2 bytes
const CHUNK_DURATION_MS = 200; // each chunk covers 200 ms of audio for better AudioContext stability
const CHUNK_SIZE = Math.floor((SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_DURATION_MS) / 1000);

export interface VoiceConfig {
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
}

// Lazy singleton TTS client — created on first use after dotenv loads
let _ttsClient: MiniMaxTTS | null = null;

function getTtsClient(): MiniMaxTTS {
  if (!_ttsClient) {
    _ttsClient = MiniMaxTTS.create({
      apiKey: process.env.MINIMAX_API_KEY || "",
    });
  }
  return _ttsClient;
}

/**
 * Synthesize text to an async generator of audio Buffer chunks.
 *
 * @param text        — sentence (or partial sentence) to synthesise
 * @param voiceConfig — voice parameters
 */
export async function* synthesize(
  text: string,
  voiceConfig: VoiceConfig,
): AsyncGenerator<Buffer> {
  if (isMockMode()) {
    yield* mockSynthesize(text, voiceConfig);
  } else {
    yield* realSynthesize(text, voiceConfig);
  }
}

// ---------------------------------------------------------------------------
// Mock implementation — generates silence buffers
// ---------------------------------------------------------------------------

async function* mockSynthesize(
  text: string,
  _voiceConfig: VoiceConfig,
): AsyncGenerator<Buffer> {
  // Approximate speech duration: ~150 ms per Chinese character, ~60 ms per ASCII char
  const estimatedMs = estimateDurationMs(text);
  const totalChunks = Math.max(1, Math.ceil(estimatedMs / CHUNK_DURATION_MS));

  // Simulate first-chunk latency
  await delay(200);

  for (let i = 0; i < totalChunks; i++) {
    // Produce a silence buffer (all zeros)
    yield Buffer.alloc(CHUNK_SIZE);
    // Simulate streaming interval
    await delay(CHUNK_DURATION_MS * 0.8);
  }
}

// ---------------------------------------------------------------------------
// Real implementation — MiniMax WebSocket TTS
// ---------------------------------------------------------------------------

async function* realSynthesize(
  text: string,
  voiceConfig: VoiceConfig,
): AsyncGenerator<Buffer> {
  const options = {
    voiceId: voiceConfig.voiceId,
    speed: voiceConfig.speed,
    volume: voiceConfig.volume,
    pitch: voiceConfig.pitch,
  };

  yield* getTtsClient().synthesizeWebSocket(text, options);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateDurationMs(text: string): number {
  let ms = 0;
  for (const ch of text) {
    // CJK characters take longer to pronounce
    ms += ch.charCodeAt(0) > 0x2000 ? 150 : 60;
  }
  return Math.max(ms, 200); // minimum 200 ms
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clone a voice from an audio buffer.
 * Returns the cloned voice ID.
 */
export async function cloneVoice(audioBuffer: Buffer, name: string): Promise<string> {
  if (isMockMode()) {
    // In mock mode, return a synthetic voice ID
    await delay(500);
    return `cloned_voice_${Date.now()}`;
  }
  return getTtsClient().cloneVoice(audioBuffer, name).then(r => r.voiceId);
}
