import type { Message, MessageRole } from "@clawer/shared";

/**
 * Extended session with runtime state.
 * The shared Session type uses number timestamps; we add voiceConfig and status.
 */
export interface BackendSession {
  id: string;
  title: string;
  agentId: string;
  voiceConfigId: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  status: "active" | "ended";
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // sweep every 60 seconds

let sessionCounter = 0;

function generateSessionId(): string {
  sessionCounter += 1;
  return `sess_${Date.now()}_${sessionCounter}`;
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SessionManager {
  private sessions = new Map<string, BackendSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.sweep(), CLEANUP_INTERVAL_MS);
    // Allow process to exit even if timer is pending
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  createSession(agentId: string, voiceConfigId: string): BackendSession {
    const id = generateSessionId();
    const now = Date.now();
    const session: BackendSession = {
      id,
      title: "New Session",
      agentId,
      voiceConfigId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      status: "active",
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): BackendSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  appendMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ): Message | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const message: Message = {
      id: generateMessageId(),
      sessionId,
      role,
      content,
      timestamp: Date.now(),
      ...(metadata ? { metadata } : {}),
    };
    session.messages.push(message);
    session.updatedAt = Date.now();
    return message;
  }

  /** Remove sessions that have been inactive beyond TTL */
  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        console.log(`[session] Cleaning up expired session: ${id}`);
        this.sessions.delete(id);
      }
    }
  }

  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
