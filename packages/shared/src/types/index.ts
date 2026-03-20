/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system";

/** 聊天消息 */
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** 会话 */
export interface Session {
  id: string;
  title: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

/** Agent 配置 */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

/** TTS 配置 */
export interface TTSConfig {
  apiKey: string;
  groupId: string;
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
}

/** 语音选项 */
export interface VoiceOption {
  voiceId: string;
  name: string;
  language: string;
  gender: "male" | "female" | "neutral";
  style?: string;
  description?: string;
}

/** WebSocket 消息事件枚举 */
export enum WSEvent {
  // 客户端 -> 服务端
  CONNECT = "connect",
  DISCONNECT = "disconnect",
  SEND_MESSAGE = "send_message",
  STOP_GENERATION = "stop_generation",
  TTS_REQUEST = "tts_request",

  // 服务端 -> 客户端
  MESSAGE_START = "message_start",
  MESSAGE_CHUNK = "message_chunk",
  MESSAGE_END = "message_end",
  MESSAGE_ERROR = "message_error",
  TTS_AUDIO = "tts_audio",
  SESSION_UPDATE = "session_update",
  AGENT_STATUS = "agent_status",
}

/** WebSocket 消息基类 */
export interface WSMessage<T = unknown> {
  event: WSEvent;
  data: T;
  timestamp: number;
}

/** API 响应基类 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
