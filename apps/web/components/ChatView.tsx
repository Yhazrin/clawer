"use client";

import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingMessageId?: string;
}

export function ChatView({ messages, streamingMessageId }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-view" ref={containerRef} role="log" aria-label="对话消息">
      {messages.length === 0 && (
        <div className="chat-empty">
          <div className="chat-empty-icon">💬</div>
          <p>开始一段对话吧</p>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          role={msg.role}
          content={msg.content}
          timestamp={msg.timestamp}
          isStreaming={msg.id === streamingMessageId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
