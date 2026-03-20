"use client";

import { memo } from "react";

export interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export const MessageBubble = memo(function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming,
}: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`message-row ${isUser ? "user" : "assistant"}`}>
      {!isUser && (
        <div className="avatar" aria-hidden="true">
          AI
        </div>
      )}
      <div className={`bubble ${isUser ? "bubble-user" : "bubble-assistant"}`}>
        <div className="bubble-content">
          {content}
          {isStreaming && <span className="typing-cursor" aria-label="正在输入">|</span>}
        </div>
        <div className="bubble-time">{formatTime(timestamp)}</div>
      </div>
      {isUser && (
        <div className="avatar avatar-user" aria-hidden="true">
          U
        </div>
      )}
    </div>
  );
});
