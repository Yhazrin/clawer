/**
 * Agent Bridge — OpenClaw Gateway 接入层。
 *
 * Mock 模式（默认）：当 OPENCLAW_API_KEY 未设置时，逐 token 输出预设回复。
 * 真实模式：调用 OpenClaw HTTP/SSE 接口，流式返回 token。
 */

const USE_MOCK = !process.env.OPENCLAW_API_KEY;

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
  if (USE_MOCK) {
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

  // Yield character-by-character (Chinese text) or by small chunks
  // to mimic realistic streaming behaviour.
  const chars = response.split("");
  for (let i = 0; i < chars.length; i++) {
    yield chars[i];
    // Simulate variable token interval: 30–80 ms
    await delay(30 + Math.random() * 50);
  }
}

// ---------------------------------------------------------------------------
// Real implementation (placeholder — integrate with openclaw package later)
// ---------------------------------------------------------------------------

async function* realSendMessage(
  _sessionId: string,
  _text: string,
): AsyncGenerator<string> {
  // TODO: Replace with actual OpenClaw Gateway call.
  // Expected pattern:
  //   const response = await fetch(`${OPENCLAW_BASE_URL}/chat/completions`, {
  //     method: "POST",
  //     headers: { Authorization: `Bearer ${OPENCLAW_API_KEY}` },
  //     body: JSON.stringify({ stream: true, messages: [...] }),
  //   });
  //   const reader = response.body!.getReader();
  //   ... parse SSE / chunked stream, yield tokens ...

  console.warn("[agent-bridge] realSendMessage not yet implemented, falling back to mock");
  yield* mockSendMessage(_sessionId, _text);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
