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
      const ctx = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      gainRef.current = gain;
      return ctx;
    } catch {
      return null;
    }
  }, [volume]);

  const unlock = useCallback(() => {
    const ctx = getContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }
    setIsUnlocked(true);
  }, [getContext]);

  const playNext = useCallback(() => {
    if (playingRef.current) return;
    const item = queueRef.current.shift();
    if (!item) {
      setIsPlaying(false);
      return;
    }

    const ctx = getContext();
    if (!ctx || !gainRef.current) return;

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

    source.start();
  }, [getContext]);

  const enqueuePcm = useCallback(
    (pcmData: ArrayBuffer, seqId: number, isFinal: boolean) => {
      const ctx = getContext();
      if (!ctx) return;

      const int16 = new Int16Array(pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const buffer = ctx.createBuffer(1, float32.length, DEFAULT_SAMPLE_RATE);
      buffer.getChannelData(0).set(float32);

      queueRef.current.push({ buffer, seqId, isFinal });
      queueRef.current.sort((a, b) => a.seqId - b.seqId);

      playNext();
    },
    [getContext, playNext]
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
      gainRef.current.gain.value = clamped;
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
