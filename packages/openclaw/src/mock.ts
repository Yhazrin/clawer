import type { AgentConfig, Message, Session } from "@clawer/shared";

/**
 * Mock Agent 客户端
 *
 * 用于无 OpenClaw 环境的开发调试:
 * - 模拟流式响应：预设中文对话，逐字输出
 * - 模拟延时：首 token 500ms，后续 30-80ms 随机
 * - 支持多轮对话：根据用户输入匹配预设回复
 */

/** 预设 Agent 列表 */
const MOCK_AGENTS: AgentConfig[] = [
  {
    id: "agent_default",
    name: "默认助手",
    description: "通用 AI 助手，可以回答各种问题",
    model: "mock-gpt-4",
    systemPrompt: "你是一个有帮助的 AI 助手。",
    temperature: 0.7,
    maxTokens: 2048,
  },
  {
    id: "agent_coder",
    name: "编程助手",
    description: "专注于编程和技术问题的 AI 助手",
    model: "mock-gpt-4",
    systemPrompt: "你是一个专业的编程助手，擅长各种编程语言和技术栈。",
    temperature: 0.3,
    maxTokens: 4096,
  },
];

/** 关键词 -> 预设回复的映射 */
const KEYWORD_REPLIES: Array<{
  keywords: string[];
  reply: string;
}> = [
  {
    keywords: ["你好", "hi", "hello", "嗨", "哈喽"],
    reply:
      "你好！我是你的AI助手，很高兴和你聊天。有什么我可以帮你的吗？",
  },
  {
    keywords: ["谢谢", "感谢", "thanks", "thank"],
    reply: "不客气！如果还有其他问题，随时可以问我。",
  },
  {
    keywords: ["再见", "拜拜", "bye", "goodbye"],
    reply: "再见！祝你一切顺利，有问题随时回来找我。",
  },
  {
    keywords: ["帮助", "能做什么", "怎么用", "功能"],
    reply:
      "我可以帮你回答问题、提供建议、协助分析问题。你可以直接输入你的问题，我会尽力帮助你。",
  },
  {
    keywords: ["代码", "编程", "bug", "debug", "程序"],
    reply:
      "关于编程问题，我建议你先检查一下常见的几个方面：输入输出是否正确、边界条件是否处理、内存是否泄漏。你能把具体的代码和错误信息发给我吗？",
  },
];

/** 默认回复列表（无关键词匹配时随机选取） */
const DEFAULT_REPLIES: string[] = [
  "这是一个很有趣的问题。让我来帮你分析一下。",
  "感谢你的提问。根据我的理解，这个问题可以从多个角度来看。",
  "好的，我理解你的意思了。让我思考一下如何更好地回答这个问题。",
  "这是一个值得深入探讨的话题。我的看法是这样的：首先，我们需要考虑问题的核心，然后逐步分析各个方面的因素。",
  "让我来梳理一下你的问题。从我的角度来看，有几个关键点需要特别注意。",
];

/** 会话上下文（用于多轮对话） */
interface MockSessionContext {
  session: Session;
  messageCount: number;
  usedReplies: Set<string>;
}

/**
 * Mock Agent 客户端
 *
 * 使用示例:
 * ```ts
 * const mock = new MockAgent();
 * const session = await mock.createSession("agent_default");
 * for await (const token of mock.sendMessageStream(session.id, "你好")) {
 *   process.stdout.write(token);
 * }
 * ```
 */
export class MockAgent {
  private sessions: Map<string, MockSessionContext> = new Map();
  private sessionCounter = 0;

  /**
   * 模拟获取 Agent 列表
   */
  async listAgents(): Promise<AgentConfig[]> {
    await this.simulateLatency(100, 200);
    return [...MOCK_AGENTS];
  }

  /**
   * 模拟创建会话
   */
  async createSession(agentId: string, title?: string): Promise<Session> {
    await this.simulateLatency(50, 150);

    const agent = MOCK_AGENTS.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.sessionCounter++;
    const session: Session = {
      id: `mock_sess_${this.sessionCounter}_${Date.now()}`,
      title: title ?? `与${agent.name}的对话`,
      agentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    this.sessions.set(session.id, {
      session,
      messageCount: 0,
      usedReplies: new Set(),
    });

    return session;
  }

  /**
   * 模拟发送消息（非流式）
   */
  async sendMessage(sessionId: string, content: string): Promise<Message> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 收集完整回复
    let fullContent = "";
    for await (const token of this.sendMessageStream(sessionId, content)) {
      fullContent += token;
    }

    const message: Message = {
      id: `mock_msg_${Date.now()}`,
      sessionId,
      role: "assistant",
      content: fullContent,
      timestamp: Date.now(),
    };

    return message;
  }

  /**
   * 模拟流式发送消息（逐字输出）
   */
  async *sendMessageStream(
    sessionId: string,
    content: string,
  ): AsyncGenerator<string> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    ctx.messageCount++;

    // 将用户消息加入历史
    const userMessage: Message = {
      id: `mock_msg_user_${Date.now()}`,
      sessionId,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    ctx.session.messages.push(userMessage);
    ctx.session.updatedAt = Date.now();

    // 匹配回复
    const reply = this.pickReply(content, ctx);

    // 首 token 延时：500ms
    await this.delay(500);

    // 逐字 yield
    for (const char of reply) {
      yield char;
      // 后续 token：30-80ms 随机延时
      await this.delay(30 + Math.random() * 50);
    }

    // 将助手回复加入历史
    const assistantMessage: Message = {
      id: `mock_msg_asst_${Date.now()}`,
      sessionId,
      role: "assistant",
      content: reply,
      timestamp: Date.now(),
    };
    ctx.session.messages.push(assistantMessage);
    ctx.session.updatedAt = Date.now();
  }

  /**
   * 根据用户输入选择回复
   */
  private pickReply(
    userInput: string,
    ctx: MockSessionContext,
  ): string {
    const lowerInput = userInput.toLowerCase();

    // 1. 尝试关键词匹配
    for (const { keywords, reply } of KEYWORD_REPLIES) {
      if (keywords.some((kw) => lowerInput.includes(kw))) {
        return reply;
      }
    }

    // 2. 从默认回复中选取一个未使用过的
    const unusedReplies = DEFAULT_REPLIES.filter(
      (r) => !ctx.usedReplies.has(r),
    );

    if (unusedReplies.length === 0) {
      // 所有回复都用过了，重置
      ctx.usedReplies.clear();
      return DEFAULT_REPLIES[0];
    }

    // 随机选取
    const index = Math.floor(Math.random() * unusedReplies.length);
    const reply = unusedReplies[index];
    ctx.usedReplies.add(reply);
    return reply;
  }

  /**
   * 模拟网络延时
   */
  private simulateLatency(min: number, max: number): Promise<void> {
    return this.delay(min + Math.random() * (max - min));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
