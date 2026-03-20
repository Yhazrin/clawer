import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { SessionManager } from "./session-manager";
import { handleUserMessage } from "./handlers/message-handler";

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

export const sessionManager = new SessionManager();

/** Map of active ws connections keyed by sessionId (if associated) */
const connections = new Map<string, WebSocket>();

// Heartbeat interval — 30 seconds
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

interface ClientState {
  ws: WebSocket;
  sessionId: string | null;
  lastPong: number;
  isAlive: boolean;
}

const clients = new Map<WebSocket, ClientState>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendWS(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ event, data, timestamp: Date.now() }));
}

/** Parse an incoming WS message, supporting both shared-types and API-contract formats. */
function parseMessage(raw: Buffer): { event: string; data: unknown } | null {
  try {
    const msg = JSON.parse(raw.toString());
    // Support both { event, data } (shared types) and { type, payload } (API contract)
    const event: string = msg.event ?? msg.type;
    const data: unknown = msg.data ?? msg.payload;
    if (!event) return null;
    return { event, data };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(wss: WebSocketServer): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.isAlive) {
        // No pong received since last ping — terminate
        console.log("[ws] Heartbeat timeout, terminating connection:", state.sessionId);
        ws.terminate();
        clients.delete(ws);
        if (state.sessionId) connections.delete(state.sessionId);
        continue;
      }
      state.isAlive = false;
      sendWS(ws, "ping", {});
    }
  }, HEARTBEAT_INTERVAL_MS);
  // Don't prevent process from exiting
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initWebSocket(server: Server): void {
  // Mount at /ws path to match API contract
  const wss = new WebSocketServer({ server, path: "/ws" });

  const heartbeatTimer = startHeartbeat(wss);

  wss.on("connection", (ws: WebSocket, req) => {
    console.log("[ws] Client connected");

    // Parse sessionId from query string: /ws?sessionId=sess_xxx
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");

    const state: ClientState = { ws, sessionId, lastPong: Date.now(), isAlive: true };
    clients.set(ws, state);

    if (sessionId) {
      connections.set(sessionId, ws);
      console.log("[ws] Associated with session:", sessionId);
    }

    // Send connected confirmation
    sendWS(ws, "connect", { connected: true });

    // ---- Message routing ----
    ws.on("message", (raw: Buffer) => {
      const parsed = parseMessage(raw);
      if (!parsed) {
        console.warn("[ws] Failed to parse message");
        sendWS(ws, "message_error", {
          error: { code: "INVALID_REQUEST", message: "Invalid JSON or missing event/type" },
        });
        return;
      }

      const { event, data } = parsed;
      const payload = (data ?? {}) as Record<string, unknown>;

      switch (event) {
        case "user_message":
          handleUserMessage(ws, sessionManager, {
            text: String(payload.text ?? ""),
            sessionId: String(payload.sessionId ?? state.sessionId ?? ""),
          });
          break;

        case "session_resume":
          handleSessionResume(ws, state, payload);
          break;

        case "voice_change":
          handleVoiceChange(ws, payload);
          break;

        case "audio_control":
          handleAudioControl(ws, payload);
          break;

        case "ping":
          handlePing(ws);
          break;

        case "pong":
          handleClientPong(ws);
          break;

        default:
          console.warn("[ws] Unknown event:", event);
          sendWS(ws, "message_error", {
            error: { code: "INVALID_REQUEST", message: `Unknown event: ${event}` },
          });
      }
    });

    ws.on("close", () => {
      console.log("[ws] Client disconnected:", state.sessionId);
      clients.delete(ws);
      if (state.sessionId) connections.delete(state.sessionId);
    });

    ws.on("error", (err) => {
      console.error("[ws] Error:", err);
      clients.delete(ws);
      if (state.sessionId) connections.delete(state.sessionId);
    });
  });

  wss.on("close", () => {
    clearInterval(heartbeatTimer);
    sessionManager.shutdown();
  });

  console.log("[ws] WebSocket server initialized at /ws");
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handlePing(ws: WebSocket): void {
  sendWS(ws, "pong", { serverTime: Date.now() });
}

function handleClientPong(ws: WebSocket): void {
  const state = clients.get(ws);
  if (state) {
    state.isAlive = true;
    state.lastPong = Date.now();
  }
}

function handleSessionResume(
  ws: WebSocket,
  state: ClientState,
  payload: Record<string, unknown>,
): void {
  const sessionId = String(payload.sessionId ?? "");
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    sendWS(ws, "message_error", {
      error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
    });
    return;
  }

  // Associate this connection with the session
  state.sessionId = sessionId;
  connections.set(sessionId, ws);

  // Return session with messages after lastSeqId
  const lastSeqId = Number(payload.lastSeqId ?? 0);
  // Simple implementation: return all messages (client can filter by seqId)
  sendWS(ws, "session_resumed", {
    sessionId,
    missedMessages: session.messages.slice(lastSeqId),
  });
}

function handleVoiceChange(
  ws: WebSocket,
  payload: Record<string, unknown>,
): void {
  const voiceConfigId = String(payload.voiceConfigId ?? "");
  console.log("[ws] Voice change requested:", voiceConfigId);
  // Acknowledge — actual config change is handled at session level
  sendWS(ws, "voice_changed", { voiceConfigId });
}

function handleAudioControl(
  ws: WebSocket,
  payload: Record<string, unknown>,
): void {
  const action = String(payload.action ?? "");
  console.log("[ws] Audio control:", action);
  // Acknowledge — the actual pause/resume/stop/skip logic would coordinate
  // with the TTS pipeline. For now we just acknowledge.
  sendWS(ws, "audio_controlled", { action });
}
