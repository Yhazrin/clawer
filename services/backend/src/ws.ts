import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { SessionManager } from "./session-manager";
import { handleUserMessage } from "./handlers/message-handler";
import { cloneVoice } from "./tts-pipeline";

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

/**
 * Send a message to the client in the format the frontend expects:
 * { type, payload, timestamp }
 */
function sendWS(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
}

/**
 * Parse an incoming WS message, supporting both { event, data } and { type, payload }.
 */
function parseMessage(raw: Buffer): { event: string; data: unknown } | null {
  try {
    const msg = JSON.parse(raw.toString());
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
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  const heartbeatTimer = startHeartbeat(wss);

  wss.on("connection", (ws: WebSocket, req) => {
    console.log("[ws] Client connected");

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
    ws.on("message", async (raw: Buffer) => {
      const parsed = parseMessage(raw);
      if (!parsed) {
        console.warn("[ws] Failed to parse message (length:", raw.length, ")");
        sendWS(ws, "message_error", {
          error: { code: "INVALID_REQUEST", message: "Invalid JSON or missing event/type" },
        });
        return;
      }

      const { event, data } = parsed;
      const payload = (data ?? {}) as Record<string, unknown>;

      switch (event) {
        case "user_message": {
          const sid = String(payload.sessionId ?? state.sessionId ?? "");
          try {
            await handleUserMessage(ws, sessionManager, {
              text: String(payload.text ?? ""),
              sessionId: sid,
            });
          } catch (err) {
            console.error("[ws] handleUserMessage error:", err);
            sendWS(ws, "message_error", {
              error: {
                code: "INTERNAL_ERROR",
                message: err instanceof Error ? err.message : "Unknown error",
              },
            });
          }
          break;
        }

        case "session_resume":
          handleSessionResume(ws, state, payload);
          break;

        case "voice_change":
          handleVoiceChange(ws, payload);
          break;

        case "audio_control":
          handleAudioControl(ws, payload);
          break;

        case "tts_config":
          handleTtsConfig(ws, sessionManager, state, payload);
          break;

        case "voice_clone":
          handleVoiceClone(ws, payload);
          break;

        case "ping":
          handlePing(ws);
          // Treat client's ping as a liveness signal
          handleClientPong(ws);
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

  state.sessionId = sessionId;
  connections.set(sessionId, ws);

  const lastSeqId = Number(payload.lastSeqId ?? 0);
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
  sendWS(ws, "voice_changed", { voiceConfigId });
}

function handleAudioControl(
  ws: WebSocket,
  payload: Record<string, unknown>,
): void {
  const action = String(payload.action ?? "");
  console.log("[ws] Audio control:", action);
  sendWS(ws, "audio_controlled", { action });
}

function handleTtsConfig(
  ws: WebSocket,
  sessionManager: SessionManager,
  state: ClientState,
  payload: Record<string, unknown>,
): void {
  const config = {
    modelId: String(payload.modelId ?? "speech-02-hd"),
    voiceId: String(payload.voiceId ?? ""),
    speed: Number(payload.speed ?? 1.0),
    volume: Number(payload.volume ?? 1.0),
    pitch: Number(payload.pitch ?? 0),
  };
  const sid = String(state.sessionId ?? "");
  if (sid) {
    sessionManager.updateTtsConfig(sid, config);
    console.log("[ws] TTS config updated for session", sid, config);
  }
  sendWS(ws, "tts_config_updated", { success: true });
}

async function handleVoiceClone(
  ws: WebSocket,
  payload: Record<string, unknown>,
): Promise<void> {
  const name = String(payload.name ?? `clone_${Date.now()}`);
  const audioBase64 = String(payload.audio ?? "");

  if (!audioBase64) {
    sendWS(ws, "voice_clone_error", { error: "Missing audio data" });
    return;
  }

  try {
    // Decode base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, "base64");
    console.log("[ws] voice_clone: name=", name, "audioBytes=", audioBuffer.length);

    const voiceId = await cloneVoice(audioBuffer, name);
    console.log("[ws] voice_clone success:", voiceId);
    sendWS(ws, "voice_clone_success", { voiceId, name });
  } catch (err) {
    console.error("[ws] voice_clone error:", err);
    sendWS(ws, "voice_clone_error", {
      error: err instanceof Error ? err.message : "Voice clone failed",
    });
  }
}
