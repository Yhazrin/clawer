import type { Message, Session, AgentConfig } from "@clawer/shared";
import type {
  OpenClawClientConfig,
  ChatCompletionRequest,
  CreateSessionRequestBody,
  SessionResponse,
  ApiErrorResponse,
  WebSocketStreamConfig,
  WebSocketStreamCallbacks,
} from "./types";
import { SSEParser } from "./sse-parser";
import { WebSocketStream } from "./websocket-stream";
import { MockAgent } from "./mock";

// Re-export types and utilities
export * from "./types";
export { SSEParser } from "./sse-parser";
export { WebSocketStream } from "./websocket-stream";
export { MockAgent } from "./mock";

/**
 * OpenClaw Agent 客户端
 *
 * 对接 OpenClaw Gateway 的 HTTP API（RESTful + SSE 流式），
 * 同时支持 WebSocket 流式模式。
 *
 * API Key 未配置时自动降级为 Mock 模式，方便本地开发调试。
 *
 * 使用示例:
 * ```ts
 * // Mock 模式（无 API Key）
 * const client = new OpenClawClient({ apiUrl: "http://localhost:3001" });
 *
 * // 真实模式
 * const client = new OpenClawClient({
 *   apiUrl: "https://gateway.openclaw.ai",
 *   apiKey: "oc_xxx",
 * });
 *
 * // 获取 Agent 列表
 * const agents = await client.listAgents();
 *
 * // 创建会话
 * const session = await client.createSession(agents[0].id);
 *
 * // 流式对话（SSE）
 * for await (const token of client.sendMessageStream(session.id, "你好")) {
 *   process.stdout.write(token);
 * }
 *
 * // 流式对话（WebSocket）
 * const wsStream = client.createWebSocketStream(session.id);
 * await wsStream.connect();
 * for await (const token of wsStream.sendMessage(session.id, "你好")) {
 *   process.stdout.write(token);
 * }
 * wsStream.disconnect();
 * ```
 */
export class OpenClawClient {
  private apiUrl: string;
  private apiKey: string;
  private timeout: number;
  private retries: number;
  private useMock: boolean;
  private mock: MockAgent | null = null;

  constructor(config: OpenClawClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/+$/, ""); // 去除尾部斜杠
    this.apiKey = config.apiKey ?? "";
    this.timeout = config.timeout ?? 30_000;
    this.retries = config.retries ?? 2;

    // API Key 为空时自动降级为 Mock 模式
    this.useMock = !this.apiKey;

    if (this.useMock) {
      this.mock = new MockAgent();
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * 获取可用 Agent 列表
   *
   * HTTP: GET /v1/agents
   */
  async listAgents(): Promise<AgentConfig[]> {
    if (this.useMock) {
      return this.mock!.listAgents();
    }

    const response = await this.request<AgentConfig[]>(
      "GET",
      "/v1/agents",
    );

    return response;
  }

  /**
   * 创建会话
   *
   * HTTP: POST /v1/sessions
   *
   * @param agentId - Agent ID
   * @param title - 可选的会话标题
   */
  async createSession(agentId: string, title?: string): Promise<Session> {
    if (this.useMock) {
      return this.mock!.createSession(agentId, title);
    }

    const body: CreateSessionRequestBody = { agent_id: agentId, title };
    const response = await this.request<SessionResponse>(
      "POST",
      "/v1/sessions",
      body,
    );

    return response.session;
  }

  /**
   * 获取会话详情
   *
   * HTTP: GET /v1/sessions/:id
   *
   * @param sessionId - 会话 ID
   */
  async getSession(sessionId: string): Promise<Session> {
    if (this.useMock) {
      throw new Error("Mock mode does not support getSession");
    }

    const response = await this.request<SessionResponse>(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}`,
    );

    return response.session;
  }

  /**
   * 发送消息（非流式）
   *
   * HTTP: POST /v1/chat/completions (stream: false)
   *
   * @param sessionId - 会话 ID
   * @param content - 消息内容
   * @returns 完整的助手回复消息
   */
  async sendMessage(sessionId: string, content: string): Promise<Message> {
    if (this.useMock) {
      return this.mock!.sendMessage(sessionId, content);
    }

    const body: ChatCompletionRequest = {
      messages: [{ role: "user", content }],
      stream: false,
      session_id: sessionId,
    };

    const response = await this.request<{
      id: string;
      choices: { message: { content: string } }[];
    }>("POST", "/v1/chat/completions", body);

    const assistantContent = response.choices?.[0]?.message?.content ?? "";

    const message: Message = {
      id: response.id,
      sessionId,
      role: "assistant",
      content: assistantContent,
      timestamp: Date.now(),
    };

    return message;
  }

  /**
   * 发送消息（流式，SSE）
   *
   * HTTP: POST /v1/chat/completions (stream: true)
   * 返回 SSE 流，逐 token yield 文本内容。
   *
   * @param sessionId - 会话 ID
   * @param content - 消息内容
   * @returns AsyncGenerator，逐 token yield 文本
   */
  async *sendMessageStream(
    sessionId: string,
    content: string,
  ): AsyncGenerator<string> {
    if (this.useMock) {
      yield* this.mock!.sendMessageStream(sessionId, content);
      return;
    }

    const body: ChatCompletionRequest = {
      messages: [{ role: "user", content }],
      stream: true,
      session_id: sessionId,
    };

    const response = await this.fetchWithRetry(
      `${this.apiUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      },
    );

    yield* SSEParser.fromResponse(response);
  }

  /**
   * 创建 WebSocket 流式连接
   *
   * 返回 WebSocketStream 实例，可调用 connect() 建立连接，
   * 然后通过 sendMessage() 流式发送和接收消息。
   *
   * @param sessionId - 会话 ID（连接后使用，也可在 sendMessage 时指定）
   */
  createWebSocketStream(
    _sessionId?: string,
    callbacks?: WebSocketStreamCallbacks,
  ): WebSocketStream {
    // 从 HTTP URL 推导 WebSocket URL
    const wsUrl = this.deriveWsUrl(this.apiUrl);

    const config: WebSocketStreamConfig = {
      wsUrl,
      apiKey: this.apiKey,
    };

    const wsStream = new WebSocketStream(wsUrl, config);

    if (callbacks) {
      if (callbacks.onConnect) wsStream.onConnect(callbacks.onConnect);
      if (callbacks.onDisconnect) wsStream.onDisconnect(callbacks.onDisconnect);
      if (callbacks.onReconnect) wsStream.onReconnect(callbacks.onReconnect);
      if (callbacks.onError) wsStream.onError(callbacks.onError);
    }

    return wsStream;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * 发起 HTTP 请求并解析 JSON 响应
   */
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const init: RequestInit = {
      method,
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchWithRetry(url, init);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorDetail: ApiErrorResponse | null = null;
      try {
        errorDetail = JSON.parse(errorBody);
      } catch {
        // 不是 JSON 格式
      }

      if (errorDetail?.error) {
        throw new OpenClawApiError(
          response.status,
          errorDetail.error.code,
          errorDetail.error.message,
        );
      }

      throw new OpenClawApiError(
        response.status,
        "UNKNOWN_ERROR",
        `HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * 带重试的 fetch
   */
  private async fetchWithRetry(
    url: string | URL,
    init: RequestInit,
    attempt = 0,
  ): Promise<Response> {
    try {
      const response = await fetch(url, init);

      // 502 等服务端错误可重试
      if (response.status >= 500 && attempt < this.retries) {
        await this.backoff(attempt);
        return this.fetchWithRetry(url, init, attempt + 1);
      }

      return response;
    } catch (err) {
      // 网络错误可重试
      if (attempt < this.retries) {
        await this.backoff(attempt);
        return this.fetchWithRetry(url, init, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * 从 HTTP URL 推导 WebSocket URL
   */
  private deriveWsUrl(httpUrl: string): string {
    if (httpUrl.startsWith("https://")) {
      return "wss://" + httpUrl.slice("https://".length) + "/v1/ws";
    }
    if (httpUrl.startsWith("http://")) {
      return "ws://" + httpUrl.slice("http://".length) + "/v1/ws";
    }
    // fallback: 假设已经是 ws 协议
    return httpUrl + "/v1/ws";
  }

  /**
   * 指数退避等待
   */
  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(1_000 * Math.pow(2, attempt), 10_000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// ============================================================
// Error Class
// ============================================================

/**
 * OpenClaw API 错误
 */
export class OpenClawApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OpenClawApiError";
    this.status = status;
    this.code = code;
  }
}
