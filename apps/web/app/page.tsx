"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket, ConnectionStatus } from "../hooks/useWebSocket";
import { useAudio } from "../hooks/useAudio";
import { ChatView, ChatMessage } from "../components/ChatView";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { AudioPlayer } from "../components/AudioPlayer";
import { SubtitleOverlay } from "../components/SubtitleOverlay";
import { VoicePanel } from "../components/VoicePanel";
import { ConversationMode, ConvMode } from "../components/ConversationMode";
import "../styles/chat.css";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "已连接",
  connecting: "连接中...",
  disconnected: "未连接",
  reconnecting: "重连中...",
};

type UIMode = "chat" | "conversation";

export default function HomePage() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [uiMode, setUiMode] = useState<UIMode>("chat");

  // Chat-mode state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | undefined>();
  const [inputText, setInputText] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [subtitleText, setSubtitleText] = useState("");
  const [showSubtitle, setShowSubtitle] = useState(false);

  // Conversation-mode state
  const [convMode, setConvMode] = useState<ConvMode>("idle");
  const [convSubtitle, setConvSubtitle] = useState("");
  const [convAiResponse, setConvAiResponse] = useState("");
  const [convAiStreaming, setConvAiStreaming] = useState(false);

  // Voice clone: when server returns cloned voice ID, select it
  const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);

  const {
    status,
    sendMessage,
    sendAudioData,
    sendAudioControl,
    sendVoiceChange,
    sendConfig,
    sendVoiceClone,
    on,
  } = useWebSocket(sessionId);

  const {
    isPlaying,
    volume,
    unlock,
    enqueuePcm,
    enqueueBase64,
    pause,
    resume,
    stop,
    changeVolume,
  } = useAudio();

  // Unlock audio on first interaction
  const handleInteraction = useCallback(() => {
    unlock();
  }, [unlock]);

  // Listen for text chunks — shared by both modes
  useEffect(() => {
    const unsub = on("text_chunk", (payload) => {
      const p = payload as {
        text: string;
        messageId: string;
        seqId: number;
        isFinal: boolean;
      };

      // Chat mode
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === p.messageId);
        if (existing) {
          return prev.map((m) =>
            m.id === p.messageId
              ? { ...m, content: m.content + p.text, isStreaming: !p.isFinal }
              : m,
          );
        }
        const newMsg: ChatMessage = {
          id: p.messageId,
          role: "assistant",
          content: p.text,
          timestamp: Date.now(),
          isStreaming: !p.isFinal,
        };
        return [...prev, newMsg];
      });

      if (!p.isFinal) {
        setStreamingId(p.messageId);
        setSubtitleText((prev) => prev + p.text);
        setShowSubtitle(true);
        // Conversation mode
        setConvAiResponse((prev) => prev + p.text);
        setConvAiStreaming(true);
        setConvMode("speaking");
      } else {
        setStreamingId(undefined);
        setTimeout(() => {
          setShowSubtitle(false);
          setSubtitleText("");
        }, 2000);
        setConvAiStreaming(false);
        setTimeout(() => setConvMode("idle"), 1500);
      }
    });

    return unsub;
  }, [on]);

  // Listen for audio chunks (base64 JSON format)
  useEffect(() => {
    const unsub = on("audio_chunk", (payload) => {
      const p = payload as {
        audio: string;
        format: string;
        sampleRate: number;
        seqId: number;
        isFinal: boolean;
      };
      enqueueBase64(p.audio, p.format, p.sampleRate, p.seqId, p.isFinal);
    });
    return unsub;
  }, [on, enqueueBase64]);

  // Listen for binary audio chunks
  useEffect(() => {
    const unsub = on("audio_chunk_binary", (payload) => {
      const buf = payload as ArrayBuffer;
      console.log("[page] audio_chunk_binary received, byteLength:", buf.byteLength);
      if (buf.byteLength >= 5) {
        const view = new DataView(buf);
        const seqId = view.getUint32(0, false);
        const flags = view.getUint8(4);
        const isFinal = (flags & 0x01) !== 0;
        const pcmData = buf.slice(5);
        console.log("[page] enqueuePcm seqId=", seqId, "isFinal=", isFinal, "pcmBytes=", pcmData.byteLength);
        enqueuePcm(pcmData, seqId, isFinal);
      } else {
        console.warn("[page] audio_chunk_binary too small, byteLength:", buf.byteLength);
      }
    });
    return unsub;
  }, [on, enqueuePcm]);

  // Listen for agent status
  useEffect(() => {
    const unsub = on("agent_status", (payload) => {
      const p = payload as { status: string; messageId?: string; error?: string };
      if (p.status === "error" && p.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `出错了: ${p.error}`,
            timestamp: Date.now(),
          },
        ]);
        setConvMode("idle");
      }
      // In conversation mode, reset to idle when done
      if (p.status === "idle" && uiMode === "conversation") {
        setTimeout(() => setConvMode("idle"), 1000);
      }
    });
    return unsub;
  }, [on, uiMode]);

  // Listen for voice clone results
  useEffect(() => {
    const unsubSuccess = on("voice_clone_success", (payload) => {
      const p = payload as { voiceId: string; name: string };
      setClonedVoiceId(p.voiceId);
      console.log("[page] voice_clone_success:", p.voiceId);
    });
    const unsubError = on("voice_clone_error", (payload) => {
      const p = payload as { error: string };
      console.error("[page] voice_clone_error:", p.error);
    });
    return () => { unsubSuccess(); unsubError(); };
  }, [on]);

  // --- Chat mode handlers ---

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    handleInteraction();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    sendMessage(text);
  }, [inputText, sendMessage, handleInteraction]);

  // Voice transcript → send as text message (Web Speech API)
  const handleVoiceTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      handleInteraction();
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      sendMessage(text.trim());
    },
    [sendMessage, handleInteraction],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleAudioReady = useCallback(
    (blob: Blob) => {
      handleInteraction();
      sendAudioData(blob);
    },
    [sendAudioData, handleInteraction],
  );

  // --- Conversation mode handlers ---

  const handleConvSendMessage = useCallback(
    (text: string) => {
      handleInteraction();
      setConvAiResponse("");
      setConvSubtitle(text);
      sendMessage(text);
    },
    [sendMessage, handleInteraction],
  );

  return (
    <div className="chat-layout" onClick={handleInteraction}>
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header-title">
          <h1>Clawer</h1>
          <div className="status-indicator">
            <span className={`status-dot ${status}`} />
            <span>{STATUS_LABEL[status]}</span>
          </div>
        </div>

        <div className="chat-header-actions">
          {/* Mode toggle */}
          <div className="mode-toggle">
            <button
              className={`mode-btn ${uiMode === "chat" ? "active" : ""}`}
              onClick={() => setUiMode("chat")}
            >
              💬 聊天
            </button>
            <button
              className={`mode-btn ${uiMode === "conversation" ? "active" : ""}`}
              onClick={() => {
                setUiMode("conversation");
                setConvSubtitle("");
                setConvAiResponse("");
                setConvMode("idle");
              }}
            >
              🎙️ 对话
            </button>
          </div>

          {uiMode === "chat" && (
            <AudioPlayer
              isPlaying={isPlaying}
              volume={volume}
              onVolumeChange={changeVolume}
              onPause={() => {
                pause();
                sendAudioControl("pause");
              }}
              onResume={() => {
                resume();
                sendAudioControl("resume");
              }}
              onStop={() => {
                stop();
                sendAudioControl("stop");
              }}
            />
          )}
        </div>
      </header>

      {/* Body */}
      <div className="chat-body">
        {uiMode === "chat" ? (
          <div className="chat-main">
            {/* Message list */}
            <ChatView messages={messages} streamingMessageId={streamingId} />

            {/* Subtitle overlay */}
            <SubtitleOverlay text={subtitleText} visible={showSubtitle} />

            {/* Input area */}
            <div className="chat-input-area">
              <div className="chat-input-wrapper">
                <textarea
                  className="chat-input"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息..."
                  rows={1}
                  aria-label="消息输入框"
                />
                <div className="input-actions">
                  <VoiceRecorder
                  onTranscript={handleVoiceTranscript}
                  onAudioReady={handleAudioReady}
                />
                </div>
                <button
                  className="send-btn"
                  onClick={handleSend}
                  disabled={!inputText.trim() && status !== "connected"}
                  aria-label="发送消息"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M2 9l14-7-7 14V9H2z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ConversationMode
            sessionId={sessionId}
            status={status}
            onSendMessage={handleConvSendMessage}
            subtitleText={convSubtitle}
            aiResponse={convAiResponse}
            aiIsStreaming={convAiStreaming}
            mode={convMode}
            onModeChange={setConvMode}
          />
        )}

        {/* Voice Panel (available in both modes) */}
        <VoicePanel
          isOpen={panelOpen}
          onToggle={() => setPanelOpen((prev) => !prev)}
          onVoiceChange={sendVoiceChange}
          onConfigChange={sendConfig}
          onVoiceClone={sendVoiceClone}
          clonedVoiceId={clonedVoiceId}
        />
      </div>
    </div>
  );
}
