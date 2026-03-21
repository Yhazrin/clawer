"use client";

import { useCallback, useRef, useState } from "react";

const DEFAULT_SAMPLE_RATE = 24000;

interface AudioQueueItem {
  buffer: AudioBuffer;
  seqId: number;
  isFinal: boolean;
}

export function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioQueueItem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const playingRef = useRef(false);

  const getContext = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    try {
      const ctx = new AudioContext({
        sampleRate: DEFAULT_SAMPLE_RATE,
        latencyHint: 'interactive'  // Low latency for real-time
      });
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      gainRef.current = gain;
      console.log("[useAudio] AudioContext created, state:", ctx.state, "sampleRate:", ctx.sampleRate);
      return ctx;
    } catch (e) {
      console.error("[useAudio] Failed to create AudioContext:", e);
      return null;
    }
  }, [volume]);

  const ensureUnlocked = useCallback((): AudioContext | null => {
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") {
      console.log("[useAudio] Context suspended, resuming...");
      ctx.resume();
    }
    return ctx;
  }, [getContext]);

  const unlock = useCallback(() => {
    // Force create the context on first user interaction
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }
    setIsUnlocked(true);
  }, [getContext]);

  const playNext = useCallback(() => {
    if (playingRef.current) {
      console.log("[useAudio] playNext: already playing, skipping");
      return;
    }
    const item = queueRef.current.shift();
    if (!item) {
      setIsPlaying(false);
      return;
    }

    const ctx = ensureUnlocked();
    if (!ctx || !gainRef.current) {
      console.log("[useAudio] playNext: no ctx or gain, ctx:", !!ctx, "gain:", !!gainRef.current);
      return;
    }

    playingRef.current = true;
    setIsPlaying(true);

    const source = ctx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(gainRef.current);
    currentSourceRef.current = source;

    source.onended = () => {
      playingRef.current = false;
      currentSourceRef.current = null;
      playNext();
    };

    console.log("[useAudio] playNext: starting source, buffer duration:", item.buffer.duration, "s, gain:", gainRef.current.gain.value);
    source.start();
  }, [ensureUnlocked]);

  const enqueuePcm = useCallback(
    (pcmData: ArrayBuffer, seqId: number, isFinal: boolean) => {
      const ctx = ensureUnlocked();
      if (!ctx) {
        console.error("[useAudio] enqueuePcm: cannot unlock/create context");
        return;
      }
      console.log("[useAudio] enqueuePcm: seqId=", seqId, "isFinal=", isFinal, "pcmBytes=", pcmData.byteLength);

      const int16 = new Int16Array(pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      // Check if audio data is all zeros (silent)
      let nonZero = 0;
      for (let i = 0; i < int16.length; i++) {
        if (int16[i] !== 0) nonZero++;
      }
      console.log("[useAudio] PCM check: total=", int16.length, "nonZero=", nonZero, "first values:", int16[0], int16[1], int16[2]);

      const buffer = ctx.createBuffer(1, float32.length, DEFAULT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      queueRef.current.push({ buffer, seqId, isFinal });
      queueRef.current.sort((a, b) => a.seqId - b.seqId);

      playNext();
    },
    [ensureUnlocked, playNext]
  );

  const enqueueBase64 = useCallback(
    (
      audioBase64: string,
      _format: string,
      _sampleRate: number,
      seqId: number,
      isFinal: boolean
    ) => {
      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      enqueuePcm(bytes.buffer, seqId, isFinal);
    },
    [enqueuePcm]
  );

  const pause = useCallback(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.onended = null;
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    playingRef.current = false;
    setIsPlaying(false);
    if (ctxRef.current?.state === "running") {
      ctxRef.current.suspend();
    }
  }, []);

  const resume = useCallback(() => {
    if (ctxRef.current?.state === "suspended") {
      console.log("[useAudio] resume: context was suspended, resuming...");
      ctxRef.current.resume();
    }
    playNext();
  }, [playNext]);

  const stop = useCallback(() => {
    queueRef.current = [];
    if (currentSourceRef.current) {
      currentSourceRef.current.onended = null;
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    playingRef.current = false;
    setIsPlaying(false);
  }, []);

  const changeVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
    if (gainRef.current) {
      gainRef.current.gain.setTargetAtTime(clamped, gainRef.current.context.currentTime, 0.02);
    }
  }, []);

  return {
    isPlaying,
    isUnlocked,
    volume,
    unlock,
    enqueuePcm,
    enqueueBase64,
    pause,
    resume,
    stop,
    changeVolume,
  };
}
