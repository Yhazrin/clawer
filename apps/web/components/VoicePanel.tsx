"use client";

import { useState } from "react";

interface Voice {
  voiceId: string;
  name: string;
  gender: string;
  language: string;
}

interface VoicePanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onVoiceChange?: (voiceId: string) => void;
  onConfigChange?: (config: {
    modelId: string;
    voiceId: string;
    speed: number;
    volume: number;
    pitch: number;
  }) => void;
}

const MODELS = [
  { modelId: "speech-01", name: "Speech-01" },
  { modelId: "speech-02-turbo", name: "Speech-02 Turbo" },
];

const VOICES: Voice[] = [
  { voiceId: "female_shuangkuai", name: "爽快女声", gender: "female", language: "zh-CN" },
  { voiceId: "male_chengshu", name: "成熟男声", gender: "male", language: "zh-CN" },
  { voiceId: "female_qinqie", name: "亲切女声", gender: "female", language: "zh-CN" },
  { voiceId: "male_qingnian", name: "青年男声", gender: "male", language: "zh-CN" },
  { voiceId: "female_wanyue", name: "温婉女声", gender: "female", language: "zh-CN" },
  { voiceId: "male_cidian", name: "磁性男声", gender: "male", language: "zh-CN" },
];

export function VoicePanel({ isOpen, onToggle, onVoiceChange, onConfigChange }: VoicePanelProps) {
  const [model, setModel] = useState("speech-01");
  const [voiceId, setVoiceId] = useState("female_shuangkuai");
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [pitch, setPitch] = useState(0);

  const emitConfig = (overrides: Partial<{ modelId: string; voiceId: string; speed: number; volume: number; pitch: number }>) => {
    const config = { modelId: model, voiceId, speed, volume, pitch, ...overrides };
    onConfigChange?.(config);
  };

  const handleModelChange = (m: string) => {
    setModel(m);
    emitConfig({ modelId: m });
  };

  const handleVoiceSelect = (v: string) => {
    setVoiceId(v);
    onVoiceChange?.(v);
    emitConfig({ voiceId: v });
  };

  return (
    <div className={`voice-panel ${isOpen ? "open" : ""}`}>
      <button className="voice-panel-toggle" onClick={onToggle} aria-label={isOpen ? "关闭音色面板" : "打开音色面板"}>
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path
            d="M10 2a1 1 0 0 1 1 1v14a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zM6 6a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V7a1 1 0 0 1 1-1zM14 4a1 1 0 0 1 1 1v10a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1zM3 9a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zM17 8a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1z"
            fill="currentColor"
          />
        </svg>
        <span>音色配置</span>
      </button>

      {isOpen && (
        <div className="voice-panel-body">
          <div className="panel-section">
            <label className="panel-label">TTS 模型</label>
            <select
              className="panel-select"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="panel-section">
            <label className="panel-label">系统音色</label>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <button
                  key={v.voiceId}
                  className={`voice-card ${voiceId === v.voiceId ? "voice-card-active" : ""}`}
                  onClick={() => handleVoiceSelect(v.voiceId)}
                >
                  <span className="voice-card-icon">
                    {v.gender === "female" ? "♀" : "♂"}
                  </span>
                  <span className="voice-card-name">{v.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <label className="panel-label">
              语速 <span className="panel-value">{speed.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setSpeed(v);
                emitConfig({ speed: v });
              }}
              className="panel-slider"
            />
          </div>

          <div className="panel-section">
            <label className="panel-label">
              音量 <span className="panel-value">{Math.round(volume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                emitConfig({ volume: v });
              }}
              className="panel-slider"
            />
          </div>

          <div className="panel-section">
            <label className="panel-label">
              音调 <span className="panel-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
            </label>
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              value={pitch}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setPitch(v);
                emitConfig({ pitch: v });
              }}
              className="panel-slider"
            />
          </div>

          <div className="panel-section">
            <label className="panel-label">音色复刻</label>
            <label className="voice-clone-btn">
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // TODO: upload for voice cloning
                  }
                }}
              />
              上传参考音频
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
