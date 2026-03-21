"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type RecordingStatus = "idle" | "recording" | "processing";

interface UseVoiceRecorderOptions {
  /** Called when a final transcript is ready (from Web Speech API) */
  onTranscript?: (text: string) => void;
  /** Called when an interim transcript updates (real-time display) */
  onInterimTranscript?: (text: string) => void;
  /** Fallback: if Web Speech API is unavailable, deliver the raw audio blob */
  onAudioReady?: (blob: Blob) => void;
}

/* ------------------------------------------------------------------ */
/*  Web Speech API feature detection (client-only)                     */
/* ------------------------------------------------------------------ */

function detectSpeechApi(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { onTranscript, onInterimTranscript, onAudioReady } = options;
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [interimText, setInterimText] = useState("");
  // SSR-safe: default false, update on client mount
  const [useSpeechApi, setUseSpeechApi] = useState(false);

  // Web Speech API refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const userStoppedRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MediaRecorder fallback refs (for browsers without Web Speech API)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Detect Speech API on client mount
  useEffect(() => {
    setUseSpeechApi(detectSpeechApi());
  }, []);

  // --- Web Speech API path ---

  const startSpeechRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    userStoppedRef.current = false;

    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.continuous = true; // keep listening through pauses
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStatus("recording");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimText(interim);
        onInterimTranscript?.(interim);
      }

      if (final) {
        setInterimText("");
        // Don't stop — let continuous mode keep listening
        // Deliver the final transcript immediately
        onTranscript?.(final.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[speech-recognition] Error:", event.error);
      // 'aborted' means we called stop/abort — don't restart
      if (event.error === "aborted" || event.error === "not-allowed") {
        setInterimText("");
        setStatus("idle");
        return;
      }
      // Other errors: try to restart if user hasn't stopped
      if (!userStoppedRef.current) {
        restartTimerRef.current = setTimeout(() => {
          try { recognition.start(); } catch { /* ignore */ }
        }, 300);
      }
    };

    recognition.onend = () => {
      // Auto-restart if user hasn't manually stopped
      // This handles brief pauses where the browser's engine stops listening
      if (!userStoppedRef.current) {
        restartTimerRef.current = setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Already started or not available — fall through to idle
            setInterimText("");
            setStatus("idle");
          }
        }, 200);
      } else {
        setInterimText("");
        setStatus("idle");
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    return true;
  }, [onTranscript, onInterimTranscript]);

  const stopSpeechRecognition = useCallback(() => {
    userStoppedRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setInterimText("");
    setStatus("idle");
  }, []);

  // --- MediaRecorder fallback path ---

  const startMediaRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        setStatus("processing");
        const blob = new Blob(chunksRef.current, {
          type: "audio/webm;codecs=opus",
        });
        onAudioReady?.(blob);
        setStatus("idle");
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };

      mediaRecorder.start(100);
      setStatus("recording");
    } catch {
      setStatus("idle");
    }
  }, [onAudioReady]);

  const stopMediaRecorder = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // --- Unified start/stop ---

  const startRecording = useCallback(() => {
    if (useSpeechApi) {
      startSpeechRecognition();
    } else {
      startMediaRecorder();
    }
  }, [useSpeechApi, startSpeechRecognition, startMediaRecorder]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      stopSpeechRecognition();
    } else if (mediaRecorderRef.current) {
      stopMediaRecorder();
    }
  }, [stopSpeechRecognition, stopMediaRecorder]);

  const toggleRecording = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle") {
      startRecording();
    }
  }, [status, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    status,
    interimText,
    startRecording,
    stopRecording,
    toggleRecording,
    useSpeechApi,
  };
}

// --- Web Speech API type augmentations ---

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }

  var SpeechRecognition: {
    prototype: SpeechRecognition;
    new (): SpeechRecognition;
  };

  interface SpeechRecognitionEventMap {
    start: Event;
    result: SpeechRecognitionEvent;
    error: SpeechRecognitionErrorEvent;
    end: Event;
  }

  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
    onresult:
      | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
      | null;
    onerror:
      | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
      | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
    addEventListener<K extends keyof SpeechRecognitionEventMap>(
      type: K,
      listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    ): void;
    removeEventListener<K extends keyof SpeechRecognitionEventMap>(
      type: K,
      listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    ): void;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }
}
