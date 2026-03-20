import type { ChatCompletionChunk } from "./types";

/**
 * SSE 流式响应解析器
 *
 * 解析 OpenAI 兼容的 SSE 格式:
 *   data: {"id":"...","object":"chat.completion.chunk",...}\n\n
 *   data: [DONE]\n\n
 *
 * 逐 token 提取文本内容，输出为 AsyncGenerator。
 */
export class SSEParser {
  /**
   * 从 ReadableStream<Uint8Array> 中解析 SSE 事件，逐 token yield 文本内容
   */
  static async *parseStream(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 流结束，处理 buffer 中残留的数据
          if (buffer.trim()) {
            yield* SSEParser.processBuffer(buffer);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // 按双换行符切分 SSE 事件
        const events = buffer.split("\n\n");
        // 最后一段可能不完整，留在 buffer 中
        buffer = events.pop() ?? "";

        for (const event of events) {
          yield* SSEParser.processEvent(event);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 处理 buffer 中可能的多个 SSE 行
   */
  private static async *processBuffer(
    buffer: string,
  ): AsyncGenerator<string> {
    const lines = buffer.split("\n");
    for (const line of lines) {
      const content = SSEParser.parseDataLine(line);
      if (content === null) continue;
      if (content === "[DONE]") return;
      yield* SSEParser.extractTokens(content);
    }
  }

  /**
   * 处理单个 SSE 事件块（由 \n\n 分隔）
   */
  private static async *processEvent(
    event: string,
  ): AsyncGenerator<string> {
    const lines = event.split("\n");
    for (const line of lines) {
      const content = SSEParser.parseDataLine(line);
      if (content === null) continue;
      if (content === "[DONE]") return;
      yield* SSEParser.extractTokens(content);
    }
  }

  /**
   * 解析 "data: ..." 行，返回 JSON 字符串或 "[DONE]"，非 data 行返回 null
   */
  private static parseDataLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("data:")) return null;
    return trimmed.slice(5).trim();
  }

  /**
   * 从 JSON 字符串中提取 token 文本
   */
  private static async *extractTokens(
    jsonStr: string,
  ): AsyncGenerator<string> {
    try {
      const chunk: ChatCompletionChunk = JSON.parse(jsonStr);
      for (const choice of chunk.choices) {
        if (choice.delta?.content) {
          yield choice.delta.content;
        }
        if (choice.finish_reason === "stop") {
          return;
        }
      }
    } catch {
      // 跳过无法解析的行（可能是注释或格式异常）
    }
  }

  /**
   * 从 Response 对象解析 SSE 流
   * @throws 如果 response 不是 ok 或 body 为空
   */
  static async *fromResponse(response: Response): AsyncGenerator<string> {
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `OpenClaw API error ${response.status}: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    yield* SSEParser.parseStream(response.body);
  }
}
