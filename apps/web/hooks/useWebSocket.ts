"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting";

interface WSIncomingMessage {
  type: string;
  payload: unknown;
  messageId?: string;
  timestamp: number;
}

type Listener = (payload: unknown) => void;

const WS_URL = "ws://localhost:3001/ws";
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const HEARTBEAT_INTERVAL = 25000;

export function useWebSocket(sessionId: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
  const reconnectIndexRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const intentionalCloseRef = useRef(false);
  sessionIdRef.current = sessionId;

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const emit = useCallback((type: string, payload: unknown) => {
    const set = listenersRef.current.get(type);
    if (set) {
      set.forEach((fn) => fn(payload));
    }
  }, []);

  const doConnect = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setStatus("connecting");
    const sid = sessionIdRef.current;
    const url = sid ? `${WS_URL}?sessionId=${sid}` : WS_URL;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectIndexRef.current = 0;
      heartbeatTimerRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "ping",
              payload: {},
              timestamp: Date.now(),
            })
          );
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg: WSIncomingMessage = JSON.parse(event.data);
          if (msg.type === "pong") return;
          // Respond to server's heartbeat ping with pong
          if (msg.type === "ping") {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({ type: "pong", payload: {}, timestamp: Date.now() })
              );
            }
            return;
          }
          emit(msg.type, msg.payload);
        } catch {
          // ignore malformed messages
        }
      } else if (event.data instanceof ArrayBuffer) {
        emit("audio_chunk_binary", event.data);
      } else if (event.data instanceof Blob) {
        // Fallback: convert Blob to ArrayBuffer
        event.data.arrayBuffer().then((buf) => {
          emit("audio_chunk_binary", buf);
        });
      }
    };

    ws.onclose = () => {
      clearTimers();
      if (!intentionalCloseRef.current) {
        const index = Math.min(
          reconnectIndexRef.current,
          RECONNECT_DELAYS.length - 1
        );
        const delay = RECONNECT_DELAYS[index];
        reconnectIndexRef.current++;
        setStatus("reconnecting");
        reconnectTimerRef.current = setTimeout(() => {
          doConnect();
        }, delay);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [clearTimers, emit]);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    doConnect();
  }, [doConnect]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearTimers();
    setStatus("disconnected");
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearTimers]);

  const send = useCallback((type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type, payload, timestamp: Date.now() })
      );
    }
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      send("user_message", {
        text,
        sessionId: sessionIdRef.current,
        messageId: crypto.randomUUID(),
      });
    },
    [send]
  );

  const sendVoiceChange = useCallback(
    (voiceConfigId: string) => {
      send("voice_change", { voiceConfigId });
    },
    [send]
  );

  const sendAudioControl = useCallback(
    (action: "pause" | "resume" | "stop" | "skip") => {
      send("audio_control", { action });
    },
    [send]
  );

  const sendAudioData = useCallback((audioBlob: Blob) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioBlob);
    }
  }, []);

  const sendConfig = useCallback((config: {
    modelId: string;
    voiceId: string;
    speed: number;
    volume: number;
    pitch: number;
  }) => {
    send("tts_config", config);
  }, [send]);

  const sendVoiceClone = useCallback((audioBuffer: ArrayBuffer, name: string) => {
    // Convert ArrayBuffer to base64
    const bytes = new Uint8Array(audioBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    send("voice_clone", { audio: base64, name });
  }, [send]);

  const on = useCallback((type: string, fn: Listener) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(fn);
    return () => {
      listenersRef.current.get(type)?.delete(fn);
    };
  }, []);

  useEffect(() => {
    intentionalCloseRef.current = false;
    doConnect();
    return () => {
      intentionalCloseRef.current = true;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [doConnect, clearTimers]);

  return {
    status,
    connect,
    disconnect,
    sendMessage,
    sendVoiceChange,
    sendAudioControl,
    sendAudioData,
    sendConfig,
    sendVoiceClone,
    on,
  };
}
