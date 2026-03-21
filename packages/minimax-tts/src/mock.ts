import type { VoiceOption } from "@clawer/shared";
import type { SynthesizeOptions, SynthesizeResult } from "./types";

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // 16-bit = 2 bytes

/**
 * Mock TTS 客户端。
 * 生成静音 PCM 音频（24000Hz, 16-bit signed LE, mono），用于无 API Key 环境下的开发调试。
 */
export class MiniMaxTTSMock {
  private static readonly MOCK_VOICES: VoiceOption[] = [
    { voiceId: "mock_female_1", name: "模拟女声-温柔", language: "zh-CN", gender: "female", style: "gentle" },
    { voiceId: "mock_female_2", name: "模拟女声-爽快", language: "zh-CN", gender: "female", style: "cheerful" },
    { voiceId: "mock_male_1", name: "模拟男声-成熟", language: "zh-CN", gender: "male", style: "mature" },
    { voiceId: "mock_male_2", name: "模拟男声-阳光", language: "zh-CN", gender: "male", style: "sunny" },
  ];

  /**
   * 文本转语音（Mock）：生成静音 PCM。
   * 模拟延时：首 chunk 200ms，后续 chunk 间隔 50ms。
   * 根据文本长度生成对应时长的音频（约每字符 80ms）。
   */
  async synthesize(text: string, _options?: SynthesizeOptions): Promise<SynthesizeResult> {
    if (!text || text.trim().length === 0) {
      throw new Error("MiniMaxTTSMock.synthesize: text must not be empty");
    }

    // 模拟网络延时 200ms（首 chunk）
    await delay(200);

    // 约每字符 80ms 的静音
    const durationMs = Math.max(200, text.length * 80);
    const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
    const audioBuffer = Buffer.alloc(numSamples * BYTES_PER_SAMPLE, 0); // silent PCM

    return {
      audio: audioBuffer,
      format: "pcm_s16le",
    };
  }

  /**
   * 获取系统音色列表（Mock）
   */
  async listVoices(): Promise<VoiceOption[]> {
    await delay(50);
    return [...MiniMaxTTSMock.MOCK_VOICES];
  }

  /**
   * 音色复刻（Mock）
   */
  async cloneVoice(_audioBuffer: Buffer, name: string): Promise<{ voiceId: string }> {
    if (!name || name.trim().length === 0) {
      throw new Error("MiniMaxTTSMock.cloneVoice: name must not be empty");
    }
    await delay(300);
    return { voiceId: `mock_cloned_${Date.now()}` };
  }

  /**
   * 流式合成（Mock）：将文本切分为多个 chunk，每个 chunk 生成一段静音。
   * 首 chunk 模拟 200ms 延时，后续 chunk 间隔 50ms。
   */
  async *synthesizeStream(text: string, options?: SynthesizeOptions): AsyncGenerator<Buffer> {
    const segments = splitIntoChunks(text, 50);
    for (let i = 0; i < segments.length; i++) {
      if (i === 0) {
        await delay(200); // 首 chunk 延时
      } else {
        await delay(50); // 后续 chunk 间隔
      }
      const segment = segments[i];
      const durationMs = Math.max(50, segment.length * 80);
      const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
      const pcm = Buffer.alloc(numSamples * BYTES_PER_SAMPLE);
      // 生成 440Hz 正弦波作为测试音（可听提示音）
      const FREQ = 440;
      const amplitude = 8000;
      for (let s = 0; s < numSamples; s++) {
        const t = s / SAMPLE_RATE;
        const sample = Math.round(amplitude * Math.sin(2 * Math.PI * FREQ * t));
        pcm.writeInt16LE(sample, s * BYTES_PER_SAMPLE);
      }
      yield pcm;
    }
  }

  /**
   * WebSocket 流式合成（Mock）：同 synthesizeStream，模拟流式返回。
   */
  async *synthesizeWebSocket(text: string, options?: SynthesizeOptions): AsyncGenerator<Buffer> {
    yield* this.synthesizeStream(text, options);
  }
}

// ---------- 辅助函数 ----------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [text];
}
