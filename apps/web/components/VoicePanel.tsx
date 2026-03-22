"use client";

import { useEffect, useState } from "react";

interface Voice {
  voiceId: string;
  name: string;
  gender: string;
  language: string;
  description?: string;
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
  onVoiceClone?: (audioBuffer: ArrayBuffer, name: string) => void;
  /** When set by parent (from voice_clone_success), auto-select this voice */
  clonedVoiceId?: string | null;
}

const MODELS = [
  { modelId: "speech-02-hd", name: "Speech-02 HD", desc: "高质量（推荐）" },
  { modelId: "speech-02-turbo", name: "Speech-02 Turbo", desc: "低延迟" },
  { modelId: "speech-2.8-hd", name: "Speech-2.8 HD", desc: "标准高质量" },
  { modelId: "speech-2.8-turbo", name: "Speech-2.8 Turbo", desc: "标准低延迟" },
  { modelId: "speech-2.6-hd", name: "Speech-2.6 HD", desc: "经典高质量" },
  { modelId: "speech-2.6-turbo", name: "Speech-2.6 Turbo", desc: "经典低延迟" },
];

const VOICES: Voice[] = [
  { voiceId: "Chinese (Mandarin)_News_Anchor", name: "新闻主播", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Young_Female", name: "年轻女声", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Young_Male", name: "年轻男声", gender: "male", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Mature_Female", name: "成熟女声", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Mature_Male", name: "成熟男声", gender: "male", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Elderly_Female", name: "老年女声", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Elderly_Male", name: "老年男声", gender: "male", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Sweet_Female", name: "甜美女声", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Calm_Male", name: "沉稳男声", gender: "male", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Cheerful_Female", name: "活泼女声", gender: "female", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Deep_Male", name: "低沉男声", gender: "male", language: "zh-CN" },
  { voiceId: "Chinese (Mandarin)_Professional_Female", name: "专业女声", gender: "female", language: "zh-CN" },
];

export function VoicePanel({ isOpen, onToggle, onVoiceChange, onConfigChange, onVoiceClone, clonedVoiceId }: VoicePanelProps) {
  const [model, setModel] = useState("speech-02-hd");
  const [voiceId, setVoiceId] = useState("Chinese (Mandarin)_News_Anchor");
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [pitch, setPitch] = useState(0);
  const [cloneFile, setCloneFile] = useState<string | null>(null);
  const [cloneStatus, setCloneStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [clonedVoiceIdLocal, setClonedVoiceIdLocal] = useState<string | null>(null);

  const emitConfig = (overrides: Partial<{ modelId: string; voiceId: string; speed: number; volume: number; pitch: number }>) => {
    const config = { modelId: model, voiceId, speed, volume, pitch, ...overrides };
    onConfigChange?.(config);
  };

  // When parent tells us about a cloned voice from the server, auto-select it
  useEffect(() => {
    if (clonedVoiceId && clonedVoiceId !== clonedVoiceIdLocal) {
      setClonedVoiceIdLocal(clonedVoiceId);
      setCloneStatus("success");
      // Auto-select the cloned voice
      setVoiceId(clonedVoiceId);
      onVoiceChange?.(clonedVoiceId);
      emitConfig({ voiceId: clonedVoiceId });
    }
  }, [clonedVoiceId]);

  const handleModelChange = (m: string) => {
    setModel(m);
    emitConfig({ modelId: m });
  };

  const handleVoiceSelect = (v: string) => {
    setVoiceId(v);
    onVoiceChange?.(v);
    emitConfig({ voiceId: v });
    setCloneFile(null); // Clear clone when selecting preset
  };

  return (
    <>
      <button className="voice-panel-toggle" onClick={onToggle} aria-label={isOpen ? "关闭音色面板" : "打开音色面板"}>
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path
            d="M10 2a1 1 0 0 1 1 1v14a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zM6 6a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V7a1 1 0 0 1 1-1zM14 4a1 1 0 0 1 1 1v10a1 1 0 0 1-2 0V5a1 1 0 0 1 1-1zM3 9a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zM17 8a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1z"
            fill="currentColor"
          />
        </svg>
        <span>语音设置</span>
      </button>

      <div className={`voice-panel ${isOpen ? "open" : ""}`}>
      {isOpen && (
        <div className="voice-panel-body">
          {/* Model selector */}
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
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {MODELS.find((m) => m.modelId === model)?.desc}
            </div>
          </div>

          {/* Voice grid */}
          <div className="panel-section">
            <label className="panel-label">系统音色</label>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <button
                  key={v.voiceId}
                  className={`voice-card ${voiceId === v.voiceId || clonedVoiceIdLocal === v.voiceId ? "voice-card-active" : ""}`}
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

          {/* Speed */}
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

          {/* Volume */}
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

          {/* Pitch */}
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

          {/* Voice cloning */}
          <div className="panel-section voice-clone-upload">
            <label className="panel-label">音色复刻</label>
            <label className="voice-clone-btn">
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !onVoiceClone) return;
                  setCloneFile(file.name);
                  setCloneStatus("uploading");
                  setClonedVoiceIdLocal(null);
                  // Read file as ArrayBuffer and pass to parent
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const buffer = ev.target?.result;
                    if (buffer instanceof ArrayBuffer) {
                      onVoiceClone(buffer, file.name.replace(/\.[^.]+$/, ""));
                    } else {
                      setCloneStatus("error");
                    }
                  };
                  reader.onerror = () => {
                    setCloneStatus("error");
                  };
                  reader.readAsArrayBuffer(file);
                }}
              />
              {cloneFile ? "🔄 重新上传" : "📁 上传参考音频"}
            </label>
            {cloneFile && (
              <div className="voice-clone-status">
                {cloneStatus === "uploading" && <span>🔄 上传中...</span>}
                {cloneStatus === "success" && clonedVoiceIdLocal && (
                  <span>✅ 复刻成功：{clonedVoiceIdLocal}</span>
                )}
                {cloneStatus === "error" && <span>❌ 复刻失败</span>}
                {cloneStatus === "idle" && <span>🎵 {cloneFile}</span>}
              </div>
            )}
            <div className="voice-clone-info">
              上传 3-10 秒清晰人声参考音频（mp3/wav），即可复刻该音色用于对话
            </div>
          </div>
        </div>
      )}
    </div>
  </>
  );
}
