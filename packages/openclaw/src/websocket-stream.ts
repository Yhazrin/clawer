import type {
  WSConnectionState,
  WebSocketStreamConfig,
  WebSocketStreamCallbacks,
  WSOutgoingMessage,
  WSIncomingMessage,
  WSTextChunkData,
  WSErrorData,
} from "./types";

/**
 * WebSocket 流式客户端封装
 *
 * 职责:
 * - 连接管理 (connect, disconnect, reconnect)
 * - 消息发送和流式接收
 * - 心跳保活
 * - 自动重连 (指数退避)
 *
 * 使用示例:
 * ```ts
 * const ws = new WebSocketStream("ws://gateway/ws", { apiKey: "xxx" });
 * ws.onConnect(() => console.log("connected"));
 *
 * // 流式接收回复
 * for await (const token of ws.sendMessage("sess_1", "你好")) {
 *   process.stdout.write(token);
 * }
 * ```
 */
export class WebSocketStream {
  private ws: WebSocket | null = null;
  private url: string;
  private config: Required<
    Pick<WebSocketStreamConfig, "heartbeatInterval" | "maxReconnectAttempts" | "reconnectBaseDelay">
  >;
  private apiKey: string;

  private _state: WSConnectionState = "disconnected";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  // 当前活跃的 generator ID
  private activeGeneratorId: string | null = null;

  // 事件回调
  private callbacks: WebSocketStreamCallbacks = {};

  constructor(url: string, config: WebSocketStreamConfig = {}) {
    this.url = url;
    this.apiKey = config.apiKey ?? "";
    this.config = {
      heartbeatInterval: config.heartbeatInterval ?? 30_000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectBaseDelay: config.reconnectBaseDelay ?? 1_000,
    };
  }

  // ============================================================
  // Public API
  // ============================================================

  /** 当前连接状态 */
  get state(): WSConnectionState {
    return this._state;
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this._state === "connected";
  }

  /** 注册事件回调 */
  onConnect(cb: () => void): this {
    this.callbacks.onConnect = cb;
    return this;
  }

  onDisconnect(cb: (reason: string) => void): this {
    this.callbacks.onDisconnect = cb;
    return this;
  }

  onReconnect(cb: (attempt: number) => void): this {
    this.callbacks.onReconnect = cb;
    return this;
  }

  onError(cb: (error: Error) => void): this {
    this.callbacks.onError = cb;
    return this;
  }

  /**
   * 建立 WebSocket 连接
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._state === "connected") {
        resolve();
        return;
      }

      this._state = "connecting";
      this.shouldReconnect = true;

      // 构造带认证的 URL
      const connectUrl = new URL(this.url);
      if (this.apiKey) {
        connectUrl.searchParams.set("apiKey", this.apiKey);
      }

      try {
        this.ws = new WebSocket(connectUrl.toString());
      } catch (err) {
        this._state = "disconnected";
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ws.onopen = () => {
        this._state = "connected";
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.callbacks.onConnect?.();
        resolve();
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        const reason = `code=${event.code} reason=${event.reason || "none"}`;

        if (this.shouldReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this._state = "disconnected";
          this.callbacks.onDisconnect?.(reason);
          this.rejectAllQueued(new Error(`WebSocket closed: ${reason}`));
        }
      };

      this.ws.onerror = () => {
        const err = new Error("WebSocket error");
        this.callbacks.onError?.(err);
        // onerror 通常紧跟着 onclose，重连逻辑在 onclose 中处理
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this._state = "disconnected";
    this.rejectAllQueued(new Error("Disconnected"));
  }

  /**
   * 发送消息并以 AsyncGenerator 形式接收流式 token
   *
   * @param sessionId - 会话 ID
   * @param content - 消息内容
   * @returns AsyncGenerator，逐 token yield 文本
   */
  async *sendMessage(
    sessionId: string,
    content: string,
  ): AsyncGenerator<string> {
    // 确保已连接
    if (this._state !== "connected") {
      await this.connect();
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 发送消息
    const outgoing: WSOutgoingMessage = {
      type: "send_message",
      data: { sessionId, content, messageId },
      timestamp: Date.now(),
    };
    this.sendJSON(outgoing);

    // 注册消息队列
    this.activeGeneratorId = messageId;
    const queue = this.getOrCreateQueue(messageId);

    // 循环 yield token
    try {
      while (true) {
        // 取出已有的 chunks
        while (queue.chunks.length > 0) {
          yield queue.chunks.shift()!;
        }

        if (queue.done) break;
        if (queue.error) throw queue.error;

        // 等待新数据到达
        await new Promise<void>((res) => {
          queue.resolve = res;
          // 防止竞态：检查在 promise 注册期间是否有新数据到达
          if (queue.chunks.length > 0 || queue.done || queue.error) {
            res();
          }
        });
      }
    } finally {
      this.activeGeneratorId = null;
      this._messageQueueInternal.delete(messageId);
    }
  }

  /**
   * 发送原始 JSON 消息
   */
  sendJSON(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(data));
  }

  /**
   * 发送 ping 心跳
   */
  sendPing(): void {
    this.sendJSON({
      type: "ping",
      data: {},
      timestamp: Date.now(),
    });
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private _messageQueueInternal: Map<
    string,
    {
      chunks: string[];
      resolve: (() => void) | null;
      done: boolean;
      error: Error | null;
    }
  > = new Map();

  private handleMessage(raw: string | ArrayBuffer | Blob): void {
    // 只处理文本消息
    if (typeof raw !== "string") return;

    let msg: WSIncomingMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // 忽略无法解析的消息
    }

    switch (msg.type) {
      case "message_chunk": {
        const data = msg.data as WSTextChunkData;
        const queue = this.activeGeneratorId
          ? this.getOrCreateQueue(this.activeGeneratorId)
          : null;
        if (queue) {
          if (data.text) {
            queue.chunks.push(data.text);
          }
          if (data.isFinal) {
            queue.done = true;
          }
          queue.resolve?.();
          queue.resolve = null;
        }
        break;
      }

      case "message_end": {
        if (this.activeGeneratorId) {
          const queue = this.getOrCreateQueue(this.activeGeneratorId);
          queue.done = true;
          queue.resolve?.();
          queue.resolve = null;
        }
        break;
      }

      case "message_error": {
        const data = msg.data as WSErrorData;
        if (this.activeGeneratorId) {
          const queue = this.getOrCreateQueue(this.activeGeneratorId);
          queue.error = new Error(`Agent error: ${data.code} - ${data.message}`);
          queue.done = true;
          queue.resolve?.();
          queue.resolve = null;
        }
        this.callbacks.onError?.(new Error(`${data.code}: ${data.message}`));
        break;
      }

      case "pong": {
        // 心跳响应，无需处理
        break;
      }
    }
  }

  private getOrCreateQueue(id: string): {
    chunks: string[];
    resolve: (() => void) | null;
    done: boolean;
    error: Error | null;
  } {
    if (!this._messageQueueInternal.has(id)) {
      this._messageQueueInternal.set(id, {
        chunks: [],
        resolve: null,
        done: false,
        error: null,
      });
    }
    return this._messageQueueInternal.get(id)!;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendPing();
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this._state = "reconnecting";
    this.reconnectAttempts++;

    // 指数退避: base * 2^(attempt-1)，加随机抖动
    const delay =
      this.config.reconnectBaseDelay *
        Math.pow(2, this.reconnectAttempts - 1) +
      Math.random() * 1_000;

    this.callbacks.onReconnect?.(this.reconnectAttempts);

    setTimeout(() => {
      this.ws = null;
      this.connect().catch((err) => {
        this.callbacks.onError?.(
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    }, delay);
  }

  private rejectAllQueued(error: Error): void {
    for (const [, queue] of this._messageQueueInternal) {
      queue.error = error;
      queue.done = true;
      queue.resolve?.();
      queue.resolve = null;
    }
    this._messageQueueInternal.clear();
  }
}
