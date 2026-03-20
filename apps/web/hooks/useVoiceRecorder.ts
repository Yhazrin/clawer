"use client";

import { useCallback, useRef, useState } from "react";

export type RecordingStatus = "idle" | "recording" | "processing";

export function useVoiceRecorder(onAudioReady?: (blob: Blob) => void) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
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

  const stopRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle") {
      startRecording();
    }
  }, [status, startRecording, stopRecording]);

  return { status, startRecording, stopRecording, toggleRecording };
}
