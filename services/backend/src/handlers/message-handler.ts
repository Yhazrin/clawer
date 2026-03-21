import type WebSocket from "ws";
import { SessionManager } from "../session-manager";
import { sendMessage } from "../agent-bridge";
import { SyncEngine } from "../sync-engine";
import { synthesize, type VoiceConfig } from "../tts-pipeline";

// Reusable default voice config
const DEFAULT_VOICE: VoiceConfig = {
  voiceId: "Chinese (Mandarin)_News_Anchor",
  speed: 1.0,
  volume: 1.0,
  pitch: 0,
};

/**
 * Send a JSON WSMessage to the client.
 */
function sendWS(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState !== ws.OPEN) {
    console.warn(`[message-handler] sendWS SKIP (not open): type=${type}`);
    return;
  }
  if (type === "text_chunk" || type === "audio_meta" || type === "agent_status") {
    console.log(`[message-handler] → sendWS type=${type} preview=${JSON.stringify(payload).slice(0, 80)}`);
  }
  ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
}

/**
 * Send a binary audio frame to the client.
 *
 * Frame layout (per API contract):
 *   [0-3]  seqId  — uint32 big-endian
 *   [4]    flags  — uint8 (bit 0 = isFinal)
 *   [5...] audio  — PCM 16-bit LE
 */
function sendAudioFrame(
  ws: WebSocket,
  seqId: number,
  audio: Buffer,
  isFinal: boolean,
): void {
  if (ws.readyState !== ws.OPEN) return;
  const header = Buffer.alloc(5);
  header.writeUInt32BE(seqId, 0);
  header.writeUInt8(isFinal ? 1 : 0, 4);
  ws.send(Buffer.concat([header, audio]));
}

/**
 * Handle a full user_message lifecycle:
 *
 * 1. Validate session
 * 2. Append user message to history
 * 3. Notify agent_status = "thinking"
 * 4. Stream agent text via SyncEngine
 * 5. Each sentence → TTS pipeline → audio_chunk binary frames
 * 6. Notify agent_status = "idle"
 */
export async function handleUserMessage(
  ws: WebSocket,
  sessionManager: SessionManager,
  payload: { text: string; sessionId: string },
): Promise<void> {
  const { text, sessionId } = payload;

  // 1. Validate session (auto-create if not exists)
  const session = sessionManager.getOrCreateSession(sessionId);
  if (session.status !== "active") {
    sendWS(ws, "message_error", {
      error: { code: "SESSION_NOT_FOUND", message: "Session not found or ended" },
    });
    return;
  }

  // 2. Append user message
  sessionManager.appendMessage(sessionId, "user", text);

  // 3. Notify thinking
  sendWS(ws, "agent_status", { status: "thinking" });

  // Determine voice config — use session-specific config if available
  const voiceConfig: VoiceConfig = session.ttsConfig
    ? {
        voiceId: session.ttsConfig.voiceId,
        speed: session.ttsConfig.speed,
        volume: session.ttsConfig.volume,
        pitch: session.ttsConfig.pitch,
      }
    : DEFAULT_VOICE;

  // Generate a single messageId for this entire assistant response
  const responseMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Sequence counters for ordering
  let textSeq = 0;
  let audioSeq = 0;
  let sentenceIndex = 0;

  try {
    // Collect full assistant response for session history
    let fullResponse = "";

    // Track all pending TTS operations
    const pendingTTS: Promise<void>[] = [];

    // 4-5. Stream agent text through SyncEngine
    // Each completed sentence triggers TTS synthesis
    const sync = new SyncEngine({
      onToken(token: string) {
        // Forward each token for typewriter rendering
        sendWS(ws, "text_chunk", {
          messageId: responseMessageId,
          text: token,
          seqId: textSeq++,
          isFinal: false,
        });
      },
      onSentence(sentence: string): Promise<void> {
        console.log(`[message-handler] onSentence: "${sentence.slice(0, 60)}"`);
        fullResponse += sentence;

        // Send audio_meta for the first sentence of this response
        if (sentenceIndex === 0) {
          sendWS(ws, "audio_meta", {
            format: "pcm",
            sampleRate: 24000,
            channels: 1,
          });
        }
        sentenceIndex++;

        // Synthesize and push audio chunks — returns a promise
        const ttsPromise = (async () => {
          let chunkCount = 0;
          for await (const chunk of synthesize(sentence, voiceConfig)) {
            sendAudioFrame(ws, audioSeq++, chunk, false);
            chunkCount++;
          }
          console.log(`[message-handler] synthesize done: ${chunkCount} audio chunks, sentence="${sentence.slice(0, 40)}"`);
        })();
        pendingTTS.push(ttsPromise);
        return ttsPromise;
      },
    });

    // Feed tokens from agent bridge into sync engine
    // Don't await receiveToken — let TTS run in parallel with next tokens
    for await (const token of sendMessage(sessionId, text)) {
      const result = sync.receiveToken(token);
      if (result) pendingTTS.push(result);
    }

    // Flush remaining buffer (last sentence may not end with punctuation)
    const lastResult = sync.flush();
    if (lastResult) pendingTTS.push(lastResult);

    // Wait for ALL TTS synthesis to complete before sending final frames
    if (pendingTTS.length > 0) {
      console.log(`[message-handler] waiting for ${pendingTTS.length} TTS operations...`);
      await Promise.all(pendingTTS);
      console.log(`[message-handler] all TTS done`);
    }

    // Mark the last text_chunk as final
    sendWS(ws, "text_chunk", {
      messageId: responseMessageId,
      text: "",
      seqId: textSeq,
      isFinal: true,
    });

    // Mark the last audio frame as final
    sendAudioFrame(ws, audioSeq, Buffer.alloc(0), true);

    // 7. Append assistant message to session history
    if (fullResponse) {
      sessionManager.appendMessage(sessionId, "assistant", fullResponse);
    }
  } catch (err) {
    console.error("[message-handler] Error during message processing:", err);
    sendWS(ws, "message_error", {
      error: {
        code: "AGENT_ERROR",
        message: err instanceof Error ? err.message : "Unknown error",
      },
    });
  } finally {
    // 8. Notify idle
    sendWS(ws, "agent_status", { status: "idle" });
  }
}
