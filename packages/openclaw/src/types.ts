import type {
  Message,
  Session,
  AgentConfig,
  WSMessage,
  ApiResponse,
} from "@clawer/shared";

// ============================================================
// OpenClaw Client Config
// ============================================================

/** OpenClaw 客户端配置 */
export interface OpenClawClientConfig {
  /** OpenClaw Gateway API 地址 */
  apiUrl: string;
  /** API Key，为空时自动降级为 Mock 模式 */
  apiKey?: string;
  /** 请求超时时间（ms），默认 30000 */
  timeout?: number;
  /** 失败重试次数，默认 2 */
  retries?: number;
}

// ============================================================
// OpenClaw Gateway API Types (HTTP REST)
// ============================================================

/** POST /v1/chat/completions 请求体 */
export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  session_id?: string;
}

/** OpenAI 兼容的消息格式 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** POST /v1/chat/completions 非流式响应 */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** POST /v1/chat/completions 流式响应 chunk */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }[];
}

/** SSE 流中的单个事件 */
export interface SSEEvent {
  /** 事件数据，对应 [DONE] 时为 null */
  data: ChatCompletionChunk | null;
  /** 是否为结束信号 */
  done: boolean;
}

/** GET /v1/agents 响应 */
export interface ListAgentsResponse {
  agents: AgentConfig[];
}

/** POST /v1/sessions 请求体 */
export interface CreateSessionRequestBody {
  agent_id: string;
  title?: string;
}

/** POST /v1/sessions 和 GET /v1/sessions/:id 响应 */
export interface SessionResponse {
  session: Session;
}

/** 通用 API 错误响应 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    type?: string;
  };
}

// ============================================================
// WebSocket Stream Types
// ============================================================

/** WebSocket 连接状态 */
export type WSConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/** WebSocketStream 配置 */
export interface WebSocketStreamConfig {
  /** Gateway WebSocket 地址，为空则从 apiUrl 推导 */
  wsUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 心跳间隔（ms），默认 30000 */
  heartbeatInterval?: number;
  /** 最大重连次数，默认 5 */
  maxReconnectAttempts?: number;
  /** 重连基础退避时间（ms），默认 1000 */
  reconnectBaseDelay?: number;
}

/** WebSocket 流事件回调 */
export interface WebSocketStreamCallbacks {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onReconnect?: (attempt: number) => void;
  onError?: (error: Error) => void;
}

/** 发送给 Gateway 的 WebSocket 消息类型 */
export type WSOutgoingMessageType =
  | "send_message"
  | "stop_generation"
  | "ping";

/** 从 Gateway 接收的 WebSocket 消息类型 */
export type WSIncomingMessageType =
  | "message_start"
  | "message_chunk"
  | "message_end"
  | "message_error"
  | "pong";

/** WS 发送消息体 */
export interface WSOutgoingMessage {
  type: WSOutgoingMessageType;
  data: {
    sessionId?: string;
    content?: string;
    messageId?: string;
  };
  timestamp: number;
}

/** WS 接收消息体 — 文本分片 */
export interface WSTextChunkData {
  text: string;
  messageId: string;
  seqId: number;
  isFinal: boolean;
}

/** WS 接收消息体 — 错误 */
export interface WSErrorData {
  code: string;
  message: string;
}

/** WS 接收消息 */
export interface WSIncomingMessage {
  type: WSIncomingMessageType;
  data: WSTextChunkData | WSErrorData | Record<string, never>;
  timestamp: number;
}

// ============================================================
// Re-export shared types for convenience
// ============================================================

export type { Message, Session, AgentConfig, WSMessage, ApiResponse };
