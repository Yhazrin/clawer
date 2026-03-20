import type {
  MiniMaxClientConfig,
  MiniMaxTTSRequest,
  MiniMaxTTSResponse,
  MiniMaxVoiceListResponse,
  MiniMaxFileUploadResponse,
  MiniMaxCloneVoiceResponse,
  MiniMaxWSTTSMessage,
  SynthesizeOptions,
  SynthesizeResult,
  VoiceOption,
} from "./types";
import { MiniMaxTTSMock } from "./mock";

const DEFAULT_BASE_URL = "https://api.minimaxi.com";
const WS_URL = "wss://api.minimaxi.com/ws/v1/t2a_v2";
const DEFAULT_MODEL = "speech-2.8-turbo";
const DEFAULT_VOICE_ID = "female-shaonv";
const DEFAULT_SPEED = 1.0;
const DEFAULT_VOLUME = 1.0;
const DEFAULT_PITCH = 0;
const DEFAULT_TIMEOUT_MS = 30_000;

// PCM defaults: 24000Hz, 16-bit signed LE, mono
export const PCM_SAMPLE_RATE = 24000;
export const PCM_FORMAT = "pcm_s16le";

export class MiniMaxTTS {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: MiniMaxClientConfig) {
    if (!config.apiKey) {
      throw new Error("MiniMaxTTS: apiKey is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * 根据 apiKey 是否有效，创建真实客户端或 Mock 客户端。
   * 传空字符串或 "mock" 时自动降级为 Mock。
   */
  static create(config: { apiKey: string; baseUrl?: string }): MiniMaxTTS | MiniMaxTTSMock {
    if (!config.apiKey || config.apiKey === "mock") {
      return new MiniMaxTTSMock();
    }
    return new MiniMaxTTS(config);
  }

  /**
   * 文本转语音 (REST)
   */
  async synthesize(text: string, options?: SynthesizeOptions): Promise<SynthesizeResult> {
    if (!text || text.trim().length === 0) {
      throw new Error("MiniMaxTTS.synthesize: text must not be empty");
    }

    const body: MiniMaxTTSRequest = {
      model: options?.model ?? DEFAULT_MODEL,
      text,
      voice_setting: {
        voice_id: options?.voiceId ?? DEFAULT_VOICE_ID,
        speed: clamp(options?.speed ?? DEFAULT_SPEED, 0.5, 2.0),
        vol: clamp(options?.volume ?? DEFAULT_VOLUME, 0.1, 2.0),
        pitch: clamp(options?.pitch ?? DEFAULT_PITCH, -12, 12),
      },
      audio_setting: {
        sample_rate: PCM_SAMPLE_RATE,
        bitrate: 64000,
        format: "pcm",
        channel: 1,
      },
    };

    const url = `${this.baseUrl}/v1/t2a_v2`;
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`MiniMaxTTS.synthesize: HTTP ${resp.status} - ${text}`);
    }

    const json = (await resp.json()) as MiniMaxTTSResponse;
    if (json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMaxTTS.synthesize: API error ${json.base_resp.status_code} - ${json.base_resp.status_msg}`
      );
    }

    const audioHex = json.data.audio;
    const audioBuffer = Buffer.from(audioHex, "hex");

    return {
      audio: audioBuffer,
      format: PCM_FORMAT,
    };
  }

  /**
   * 获取系统音色列表 (POST /v1/get_voice)
   */
  async listVoices(): Promise<VoiceOption[]> {
    const url = `${this.baseUrl}/v1/get_voice`;
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: "system" }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`MiniMaxTTS.listVoices: HTTP ${resp.status} - ${text}`);
    }

    const json = (await resp.json()) as MiniMaxVoiceListResponse;
    if (json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMaxTTS.listVoices: API error ${json.base_resp.status_code} - ${json.base_resp.status_msg}`
      );
    }

    return (json.system_voice || []).map((v) => ({
      voiceId: v.voice_id,
      name: v.voice_name,
      language: v.language ?? "zh-CN",
      gender: normalizeGender(v.gender),
      style: v.style,
      description: v.description,
    }));
  }

  /**
   * 音色复刻：2-step 流程
   * 1. 上传音频文件 → file_id
   * 2. 调用 /v1/voice_clone → voice_id
   */
  async cloneVoice(
    audioBuffer: Buffer,
    name: string,
    options?: { promptAudio?: Buffer; promptText?: string; text?: string; model?: string }
  ): Promise<{ voiceId: string }> {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("MiniMaxTTS.cloneVoice: audioBuffer must not be empty");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("MiniMaxTTS.cloneVoice: name must not be empty");
    }

    // Step 1: 上传复刻音频
    const fileId = await this.uploadFile(audioBuffer, `${name}.wav`, "voice_clone");

    // Step 2 (可选): 上传示例音频
    let promptFileId: string | undefined;
    if (options?.promptAudio) {
      promptFileId = await this.uploadFile(options.promptAudio, `${name}_prompt.wav`, "prompt_audio");
    }

    // Step 3: 调用复刻接口
    const cloneUrl = `${this.baseUrl}/v1/voice_clone`;
    const cloneBody: Record<string, unknown> = {
      file_id: fileId,
      voice_id: name,
      text: options?.text ?? "这是一段测试语音。",
      model: options?.model ?? DEFAULT_MODEL,
    };
    if (promptFileId && options?.promptText) {
      cloneBody.clone_prompt = {
        prompt_audio: promptFileId,
        prompt_text: options.promptText,
      };
    }

    const resp = await this.fetchWithTimeout(cloneUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cloneBody),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`MiniMaxTTS.cloneVoice: HTTP ${resp.status} - ${text}`);
    }

    const json = (await resp.json()) as MiniMaxCloneVoiceResponse;
    if (json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMaxTTS.cloneVoice: API error ${json.base_resp.status_code} - ${json.base_resp.status_msg}`
      );
    }

    return { voiceId: json.voice_id };
  }

  /**
   * 流式合成 (REST 分段): 将长文本按句号切分，逐段调用 synthesize。
   * 适用于不支持 WebSocket 的场景。
   */
  async *synthesizeStream(
    text: string,
    options?: SynthesizeOptions
  ): AsyncGenerator<Buffer> {
    const segments = splitText(text);
    for (const segment of segments) {
      if (segment.trim().length === 0) continue;
      const result = await this.synthesize(segment, options);
      yield result.audio;
    }
  }

  /**
   * WebSocket 流式 TTS：真正的实时流式合成。
   * 返回 AsyncGenerator，逐块 yield PCM audio Buffer。
   */
  async *synthesizeWebSocket(
    text: string,
    options?: SynthesizeOptions
  ): AsyncGenerator<Buffer> {
    const wsModule = await import("ws");
    const WsClass = wsModule.WebSocket || wsModule.default;
    const ws = new WsClass(WS_URL, undefined, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    }) as any;

    const chunks: Buffer[] = [];

    const resultPromise = new Promise<Buffer[]>((resolve, reject) => {
      ws.on("open", () => {
        // wait for connected_success event
      });

      ws.on("message", (data: Buffer | string) => {
        const msg: MiniMaxWSTTSMessage = JSON.parse(data.toString());

        if (msg.event === "connected_success") {
          ws.send(
            JSON.stringify({
              event: "task_start",
              model: options?.model ?? DEFAULT_MODEL,
              voice_setting: {
                voice_id: options?.voiceId ?? DEFAULT_VOICE_ID,
                speed: clamp(options?.speed ?? DEFAULT_SPEED, 0.5, 2.0),
                vol: clamp(options?.volume ?? DEFAULT_VOLUME, 0.1, 2.0),
                pitch: clamp(options?.pitch ?? DEFAULT_PITCH, -12, 12),
              },
              audio_setting: {
                sample_rate: PCM_SAMPLE_RATE,
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
              text,
            })
          );
        }

        if (msg.data?.audio) {
          const buf = Buffer.from(msg.data.audio, "hex");
          chunks.push(buf);
        }

        if (msg.is_final) {
          ws.send(JSON.stringify({ event: "task_finish" }));
          ws.close();
          resolve(chunks);
        }
      });

      ws.on("error", (err: Error) => {
        reject(err);
      });
    });

    const result = await resultPromise;
    for (const chunk of result) {
      yield chunk;
    }
  }

  // ---------- 内部方法 ----------

  /**
   * 上传文件到 MiniMax
   */
  private async uploadFile(
    audioBuffer: Buffer,
    filename: string,
    purpose: "voice_clone" | "prompt_audio"
  ): Promise<string> {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);

    const url = `${this.baseUrl}/v1/files/upload`;
    const resp = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`MiniMaxTTS.uploadFile: HTTP ${resp.status} - ${text}`);
    }

    const json = (await resp.json()) as MiniMaxFileUploadResponse;
    if (json.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMaxTTS.uploadFile: API error ${json.base_resp.status_code} - ${json.base_resp.status_msg}`
      );
    }

    return json.file.file_id;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      return resp;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`MiniMaxTTS: request timeout after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------- 辅助函数 ----------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeGender(g: string | undefined): "male" | "female" | "neutral" {
  if (!g) return "neutral";
  const lower = g.toLowerCase();
  if (lower.includes("female") || lower === "女") return "female";
  if (lower.includes("male") || lower === "男") return "male";
  return "neutral";
}

/**
 * 按中文句号、英文句号、问号、感叹号、换行符切分文本。
 */
function splitText(text: string): string[] {
  if (text.length <= 300) return [text];

  const segments: string[] = [];
  const re = /[^。！？.!?\n]+[。！？.!?\n]?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    segments.push(match[0]);
  }
  if (segments.length === 0) {
    segments.push(text);
  }
  return segments;
}

// Re-export types & mock
export type {
  MiniMaxClientConfig,
  SynthesizeOptions,
  SynthesizeResult,
  VoiceOption,
} from "./types";
export { MiniMaxTTSMock } from "./mock";
