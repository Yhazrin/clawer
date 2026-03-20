"use client";

import { useVoiceRecorder } from "../hooks/useVoiceRecorder";

interface VoiceRecorderProps {
  onAudioReady: (blob: Blob) => void;
}

export function VoiceRecorder({ onAudioReady }: VoiceRecorderProps) {
  const { status, toggleRecording } = useVoiceRecorder(onAudioReady);
  const isRecording = status === "recording";

  return (
    <button
      className={`voice-btn ${isRecording ? "voice-btn-recording" : ""}`}
      onClick={toggleRecording}
      disabled={status === "processing"}
      aria-label={isRecording ? "停止录音" : "开始录音"}
      title={isRecording ? "点击停止录音" : "点击开始录音"}
    >
      {isRecording ? (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 1a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
            fill="currentColor"
          />
          <path
            d="M5 9a5 5 0 0 0 10 0M10 14v4M7 18h6"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )}
      {isRecording && <span className="pulse-ring" />}
    </button>
  );
}
