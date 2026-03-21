/**
 * Agent Bridge — OpenClaw Gateway 接入层。
 *
 * Mock 模式（默认）：当 OPENCLAW_API_KEY 未设置时，逐 token 输出预设回复。
 * 真实模式：调用 OpenClaw HTTP/SSE 接口，流式返回 token。
 *
 * 注意：环境变量在运行时读取（非模块加载时），因为 dotenv 在 index.ts 中
 * 于 import 之后才执行。
 */

// Lazy env accessors — evaluated at call time, not import time
function getUseMock(): boolean {
  return !process.env.OPENCLAW_API_KEY;
}
function getApiUrl(): string {
  return process.env.OPENCLAW_API_URL || "http://127.0.0.1:18789";
}
function getApiKey(): string {
  return process.env.OPENCLAW_API_KEY || "";
}
function getAgentId(): string {
  return process.env.OPENCLAW_AGENT_ID || "main";
}

// Pre-defined mock responses cycled for demo purposes
const MOCK_RESPONSES: string[] = [
  "你好！我是你的 AI 助手。很高兴和你聊天。有什么我可以帮你的吗？",
  "这个问题很有意思。让我思考一下... 其实，答案取决于你的具体需求。你能详细描述一下吗？",
  "好的，我明白了。根据你的情况，我建议你可以尝试以下方法：首先，明确目标；其次，制定计划；最后，执行并反馈。希望这对你有帮助！",
];

let mockIndex = 0;

/**
 * Send a user message and get an async generator of text tokens.
 *
 * @param sessionId — used for context continuity (mock ignores it)
 * @param text      — user input text
 */
export async function* sendMessage(
  sessionId: string,
  text: string,
): AsyncGenerator<string> {
  if (getUseMock()) {
    yield* mockSendMessage(sessionId, text);
  } else {
    yield* realSendMessage(sessionId, text);
  }
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

async function* mockSendMessage(
  _sessionId: string,
  _text: string,
): AsyncGenerator<string> {
  const response = MOCK_RESPONSES[mockIndex % MOCK_RESPONSES.length];
  mockIndex += 1;

  // Simulate first-token latency
  await delay(500);

  // Yield character-by-character (Chinese text) to mimic realistic streaming
  const chars = response.split("");
  for (let i = 0; i < chars.length; i++) {
    yield chars[i];
    await delay(30 + Math.random() * 50);
  }
}

// ---------------------------------------------------------------------------
// Real implementation — OpenClaw Gateway /v1/chat/completions (SSE)
// ---------------------------------------------------------------------------

async function* realSendMessage(
  sessionId: string,
  text: string,
): AsyncGenerator<string> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  const agentId = getAgentId();
  const url = `${apiUrl}/v1/chat/completions`;

  console.log(`[agent-bridge] → OpenClaw agent=${agentId} url=${url}`);

  const body = {
    model: "openclaw",
    stream: true,
    // Use `user` field to derive a stable session key for context continuity
    user: sessionId,
    messages: [{ role: "user", content: text }],
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-openclaw-agent-id": agentId,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[agent-bridge] fetch failed:", err);
    throw new Error(
      `OpenClaw connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.error("[agent-bridge] API error:", response.status, errText);
    throw new Error(`OpenClaw API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error("OpenClaw response body is null");
  }

  // Parse SSE stream
  let tokenCount = 0;
  for await (const token of parseSSEStream(response.body)) {
    tokenCount++;
    yield token;
  }
  console.log(`[agent-bridge] SSE done, yielded ${tokenCount} tokens`);
}

/**
 * Parse an SSE ReadableStream into an async generator of text tokens.
 */
async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (buffer.trim()) {
          yield* processSSELines(buffer);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split on double newline (SSE event boundary)
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        yield* processSSEEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process a single SSE event block.
 */
async function* processSSEEvent(event: string): AsyncGenerator<string> {
  const lines = event.split("\n");
  for (const line of lines) {
    yield* processSSELine(line);
  }
}

/**
 * Process raw buffer lines (fallback for incomplete events).
 */
async function* processSSELines(buffer: string): AsyncGenerator<string> {
  const lines = buffer.split("\n");
  for (const line of lines) {
    yield* processSSELine(line);
  }
}

/**
 * Parse a single SSE "data: ..." line and extract text tokens.
 */
async function* processSSELine(line: string): AsyncGenerator<string> {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return;

  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return;

  try {
    const chunk = JSON.parse(data);
    for (const choice of chunk.choices ?? []) {
      if (choice.delta?.content) {
        yield choice.delta.content;
      }
      if (choice.finish_reason === "stop") {
        return;
      }
    }
  } catch {
    // Skip unparseable lines
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
