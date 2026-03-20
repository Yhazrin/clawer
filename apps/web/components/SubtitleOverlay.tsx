"use client";

interface SubtitleOverlayProps {
  text: string;
  visible: boolean;
}

export function SubtitleOverlay({ text, visible }: SubtitleOverlayProps) {
  if (!visible || !text) return null;

  return (
    <div className="subtitle-overlay" role="status" aria-live="polite" aria-label="当前播报字幕">
      <div className="subtitle-text">{text}</div>
    </div>
  );
}
