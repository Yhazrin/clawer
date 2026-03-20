"use client";

import { useCallback, useEffect, useState } from "react";
import { useWebSocket, ConnectionStatus } from "../hooks/useWebSocket";
import { useAudio } from "../hooks/useAudio";
import { ChatView, ChatMessage } from "../components/ChatView";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { AudioPlayer } from "../components/AudioPlayer";
import { SubtitleOverlay } from "../components/SubtitleOverlay";
import { VoicePanel } from "../components/VoicePanel";
import "../styles/chat.css";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "已连接",
  connecting: "连接中...",
  disconnected: "未连接",
  reconnecting: "重连中...",
};

export default function HomePage() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingId, setStreamingId] = useState<string | undefined>();
  const [inputText, setInputText] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [subtitleText, setSubtitleText] = useState("");
  const [showSubtitle, setShowSubtitle] = useState(false);

  const {
    status,
    sendMessage,
    sendAudioData,
    sendAudioControl,
    sendVoiceChange,
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

  // Listen for text chunks from WebSocket
  useEffect(() => {
    const unsub = on("text_chunk", (payload) => {
      const p = payload as {
        text: string;
        messageId: string;
        seqId: number;
        isFinal: boolean;
      };

      setMessages((prev) => {
        const existing = prev.find((m) => m.id === p.messageId);
        if (existing) {
          return prev.map((m) =>
            m.id === p.messageId
              ? { ...m, content: m.content + p.text, isStreaming: !p.isFinal }
              : m
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
      } else {
        setStreamingId(undefined);
        // Keep subtitle visible for a brief moment after final
        setTimeout(() => {
          setShowSubtitle(false);
          setSubtitleText("");
        }, 2000);
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
      // Parse binary frame: [0-3] seqId, [4] flags, [5...] PCM data
      if (buf.byteLength >= 5) {
        const view = new DataView(buf);
        const seqId = view.getUint32(0, false);
        const flags = view.getUint8(4);
        const isFinal = (flags & 0x01) !== 0;
        const pcmData = buf.slice(5);
        enqueuePcm(pcmData, seqId, isFinal);
      }
    });
    return unsub;
  }, [on, enqueuePcm]);

  // Listen for agent status
  useEffect(() => {
    const unsub = on("agent_status", (payload) => {
      const p = payload as { status: string; messageId?: string; error?: string };
      if (p.status === "error" && p.error) {
        // Append error as a system message
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `出错了: ${p.error}`,
            timestamp: Date.now(),
          },
        ]);
      }
    });
    return unsub;
  }, [on]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleAudioReady = useCallback(
    (blob: Blob) => {
      handleInteraction();
      sendAudioData(blob);
    },
    [sendAudioData, handleInteraction]
  );

  return (
    <div className="chat-layout" onClick={handleInteraction}>
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header-title">
          <h1>Clawer 实时对话</h1>
          <div className="status-indicator">
            <span className={`status-dot ${status}`} />
            <span>{STATUS_LABEL[status]}</span>
          </div>
        </div>
        <div className="chat-header-actions">
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
        </div>
      </header>

      {/* Body */}
      <div className="chat-body">
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
                <VoiceRecorder onAudioReady={handleAudioReady} />
              </div>
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!inputText.trim() && status !== "connected"}
                aria-label="发送消息"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path
                    d="M2 9l14-7-7 14V9H2z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Voice Panel */}
        <VoicePanel
          isOpen={panelOpen}
          onToggle={() => setPanelOpen((prev) => !prev)}
          onVoiceChange={sendVoiceChange}
        />
      </div>
    </div>
  );
}
