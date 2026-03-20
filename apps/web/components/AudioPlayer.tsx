"use client";

interface AudioPlayerProps {
  isPlaying: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function AudioPlayer({
  isPlaying,
  volume,
  onVolumeChange,
  onPause,
  onResume,
  onStop,
}: AudioPlayerProps) {
  return (
    <div className="audio-player" role="region" aria-label="音频播放控制">
      <button
        className="audio-ctrl-btn"
        onClick={isPlaying ? onPause : onResume}
        aria-label={isPlaying ? "暂停播放" : "继续播放"}
      >
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 16 16">
            <rect x="3" y="2" width="4" height="12" rx="1" fill="currentColor" />
            <rect x="9" y="2" width="4" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path d="M4 2l10 6-10 6V2z" fill="currentColor" />
          </svg>
        )}
      </button>

      <button
        className="audio-ctrl-btn"
        onClick={onStop}
        aria-label="停止播放"
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" />
        </svg>
      </button>

      <div className="volume-control">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 6h2l4-3v10L4 10H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"
            fill="currentColor"
          />
          {volume > 0.4 && (
            <path
              d="M11 4.5a5 5 0 0 1 0 7M13 2a8 8 0 0 1 0 12"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="volume-slider"
          aria-label="音量"
        />
      </div>

      {isPlaying && (
        <span className="playing-indicator" aria-label="播放中">
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </span>
      )}
    </div>
  );
}
