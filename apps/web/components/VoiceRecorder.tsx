"use client";

import { useVoiceRecorder } from "../hooks/useVoiceRecorder";

interface VoiceRecorderProps {
  onAudioReady: (blob: Blob) => void;
  onTranscript?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
}

export function VoiceRecorder({
  onAudioReady,
  onTranscript,
  onInterimTranscript,
}: VoiceRecorderProps) {
  const {
    status,
    interimText,
    toggleRecording,
    useSpeechApi,
  } = useVoiceRecorder({
    onTranscript,
    onInterimTranscript,
    onAudioReady,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {/* Interim transcript preview */}
      {status === "recording" && interimText && (
        <span
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {interimText}
        </span>
      )}

      <button
        className={`voice-btn ${status === "recording" ? "voice-btn-recording" : ""}`}
        onClick={toggleRecording}
        aria-label={status === "recording" ? "停止录音" : "开始语音输入"}
        title={useSpeechApi ? "语音输入（实时转文字）" : "语音输入（需后端转录）"}
      >
        {/* Mic icon */}
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          {status === "recording" ? (
            /* Stop square */
            <rect x="4" y="4" width="10" height="10" rx="1.5" fill="currentColor" />
          ) : (
            /* Mic */
            <>
              <path
                d="M9 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 9 1z"
                fill="currentColor"
              />
              <path
                d="M4.5 7.5a4.5 4.5 0 0 0 9 0M9 13v3.5M6.5 16.5h5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                fill="none"
              />
            </>
          )}
        </svg>
        {status === "recording" && <span className="pulse-ring" />}
      </button>
    </div>
  );
}
