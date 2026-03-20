import type { TTSConfig, VoiceOption } from "@clawer/shared";

/** MiniMax TTS 请求体 (POST /v1/t2a_v2) */
export interface MiniMaxTTSRequest {
  model: string;
  text: string;
  voice_setting: {
    voice_id: string;
    speed: number;
    vol: number;
    pitch: number;
  };
  audio_setting: {
    sample_rate: number;
    bitrate: number;
    format: string;
    channel: number;
  };
}

/** MiniMax TTS 响应 */
export interface MiniMaxTTSResponse {
  data: {
    audio: string; // hex encoded audio
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/** MiniMax 系统音色项 */
export interface MiniMaxSystemVoice {
  voice_id: string;
  voice_name: string;
  language?: string;
  gender?: string;
  style?: string;
  description?: string;
}

/** MiniMax 音色列表请求体 */
export interface MiniMaxVoiceListRequest {
  voice_type: "system" | "voice_cloning" | "voice_generation" | "all";
}

/** MiniMax 音色列表响应 */
export interface MiniMaxVoiceListResponse {
  system_voice?: MiniMaxSystemVoice[];
  voice_cloning?: MiniMaxSystemVoice[];
  voice_generation?: MiniMaxSystemVoice[];
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/** MiniMax 文件上传响应 */
export interface MiniMaxFileUploadResponse {
  file: {
    file_id: string;
  };
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/** MiniMax 音色复刻响应 */
export interface MiniMaxCloneVoiceResponse {
  voice_id: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/** MiniMax 客户端配置 */
export interface MiniMaxClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

/** synthesize 方法选项 */
export interface SynthesizeOptions {
  model?: string;
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
}

/** 合成结果 */
export interface SynthesizeResult {
  audio: Buffer;
  format: string;
}

/** WebSocket TTS 事件 */
export interface MiniMaxWSTTSMessage {
  event: string;
  data?: {
    audio?: string;
    status?: number;
  };
  is_final?: boolean;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

/** 导出共享类型供外部使用 */
export type { TTSConfig, VoiceOption };
