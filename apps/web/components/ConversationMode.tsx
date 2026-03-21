"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {} from "../hooks/useVoiceRecorder"; // Pull in global SpeechRecognition types

/* ------------------------------------------------------------------ */
/*  VoiceVisualizer — real-time audio level bars                       */
/* ------------------------------------------------------------------ */

interface VoiceVisualizerProps {
  stream: MediaStream | null;
  isRecording: boolean;
}

function VoiceVisualizer({ stream, isRecording }: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !isRecording) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext("2d")!;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);

      const { width, height } = canvas;
      c.clearRect(0, 0, width, height);

      const barCount = 24;
      const barWidth = width / barCount;
      const gap = 2;

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * data.length);
        const val = data[idx] / 255;
        const barH = Math.max(4, val * height * 0.8);
        const x = i * barWidth + gap / 2;
        const y = (height - barH) / 2;

        const alpha = 0.4 + val * 0.6;
        c.fillStyle = `rgba(59, 130, 246, ${alpha})`;
        c.beginPath();
        c.roundRect(x, y, barWidth - gap, barH, 2);
        c.fill();
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      source.disconnect();
      ctx.close();
    };
  }, [stream, isRecording]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={64}
      style={{ opacity: isRecording ? 1 : 0, transition: "opacity 0.3s" }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Web Speech API helpers                                             */
/* ------------------------------------------------------------------ */

function getSpeechRecognition():
  | typeof window.SpeechRecognition
  | typeof window.webkitSpeechRecognition
  | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

/* ------------------------------------------------------------------ */
/*  ConversationMode — main component                                  */
/* ------------------------------------------------------------------ */

export type ConvMode = "idle" | "recording" | "processing" | "speaking";

interface ConversationModeProps {
  sessionId: string;
  status: string;
  onSendMessage: (text: string) => void;
  subtitleText: string;
  aiResponse: string;
  aiIsStreaming: boolean;
  mode: ConvMode;
  onModeChange: (mode: ConvMode) => void;
}

export function ConversationMode({
  status,
  onSendMessage,
  subtitleText,
  aiResponse,
  aiIsStreaming,
  mode,
  onModeChange,
}: ConversationModeProps) {
  const [userText, setUserText] = useState("");
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const hasResultRef = useRef(false);

  // --- Web Speech API recording ---

  const startSpeechRecognition = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      // Fallback: no Web Speech API available
      onModeChange("idle");
      return;
    }

    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    hasResultRef.current = false;

    recognition.onstart = () => {
      onModeChange("recording");
      setInterimText("");
      // Start audio visualization
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(setMicStream)
        .catch(() => {});
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimText(interim);
      }

      if (final) {
        hasResultRef.current = true;
        setInterimText("");
        onModeChange("processing");
        stopMicStream();
        // Send the transcript
        onSendMessage(final.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[conv-speech] Error:", event.error);
      setInterimText("");
      stopMicStream();
      if (event.error === "not-allowed") {
        // Mic permission denied
        onModeChange("idle");
      } else if (!hasResultRef.current) {
        onModeChange("idle");
      }
    };

    recognition.onend = () => {
      // If we got interim but no final, send the interim
      if (!hasResultRef.current && interimText.trim()) {
        setInterimText("");
        onModeChange("processing");
        stopMicStream();
        onSendMessage(interimText.trim());
      } else if (!hasResultRef.current) {
        stopMicStream();
        onModeChange("idle");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onModeChange, onSendMessage, interimText]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    stopMicStream();
    if (!hasResultRef.current) {
      onModeChange("idle");
    }
  }, [onModeChange]);

  const stopMicStream = useCallback(() => {
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      setMicStream(null);
    }
  }, [micStream]);

  // --- Mic button handler ---

  const handleMicTap = useCallback(() => {
    if (mode === "recording") {
      stopSpeechRecognition();
    } else if (mode === "idle") {
      startSpeechRecognition();
    }
  }, [mode, startSpeechRecognition, stopSpeechRecognition]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  // --- Text input ---
  const handleTextSend = useCallback(() => {
    const t = userText.trim();
    if (!t) return;
    onSendMessage(t);
    setUserText("");
  }, [userText, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleTextSend();
      }
    },
    [handleTextSend],
  );

  // --- Status labels ---
  const modeLabel: Record<ConvMode, string> = {
    idle: "点击麦克风开始对话",
    recording: interimText || "正在聆听…",
    processing: "思考中…",
    speaking: "AI 正在回复…",
  };

  const isConnected = status === "connected";

  return (
    <div className="conv-mode">
      {/* Status banner */}
      <div className={`conv-status-banner ${isConnected ? "ok" : "err"}`}>
        {isConnected ? "已连接" : "未连接"}
      </div>

      {/* Transcription / Response area */}
      <div className="conv-viewport">
        {/* User transcript */}
        {(subtitleText || interimText) && (
          <div className="conv-bubble conv-user-bubble">
            <div className="conv-bubble-label">你说</div>
            <div className="conv-bubble-text">
              {subtitleText || interimText}
              {mode === "recording" && interimText && (
                <span className="typing-cursor" style={{ color: "rgba(255,255,255,0.5)" }}>|</span>
              )}
            </div>
          </div>
        )}

        {/* AI response */}
        {aiResponse && (
          <div className="conv-bubble conv-ai-bubble">
            <div className="conv-bubble-label">AI 回复</div>
            <div className="conv-bubble-text">
              {aiResponse}
              {aiIsStreaming && <span className="typing-cursor">|</span>}
            </div>
          </div>
        )}
      </div>

      {/* Mic + Visualizer */}
      <div className="conv-controls">
        <VoiceVisualizer stream={micStream} isRecording={mode === "recording"} />

        <button
          className={`conv-mic-btn ${mode}`}
          onClick={handleMicTap}
          disabled={!isConnected && mode === "idle"}
          aria-label={mode === "recording" ? "停止录音" : "开始对话"}
        >
          {mode === "idle" && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" fill="currentColor" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5M9 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {mode === "recording" && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          )}
          {mode === "processing" && <div className="conv-spinner" />}
          {mode === "speaking" && (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z" />
              <path d="M5 10a7 7 0 0 0 14 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {mode === "recording" && <span className="pulse-ring" />}
        </button>

        <div className="conv-hint">{modeLabel[mode]}</div>

        {/* Text fallback input */}
        <div className="conv-text-input">
          <input
            type="text"
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="或者输入文字…"
            disabled={!isConnected}
          />
          <button onClick={handleTextSend} disabled={!userText.trim() || !isConnected}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// Web Speech API types are declared in hooks/useVoiceRecorder.ts
