import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initWebSocket, sessionManager } from "./ws";
import type { ApiResponse } from "@clawer/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;
const HOST = process.env.BACKEND_HOST || "0.0.0.0";

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now(),
    mock: {
      openclaw: !process.env.OPENCLAW_API_KEY,
      minimax: !process.env.MINIMAX_API_KEY,
    },
  });
});

// ---------------------------------------------------------------------------
// Session routes
// ---------------------------------------------------------------------------

app.post("/api/sessions", (req, res) => {
  const { agentId, voiceConfigId } = req.body ?? {};

  if (!agentId || typeof agentId !== "string") {
    const body: ApiResponse = {
      success: false,
      error: { code: "INVALID_REQUEST", message: "agentId is required" },
    };
    res.status(400).json(body);
    return;
  }

  const session = sessionManager.createSession(
    agentId,
    typeof voiceConfigId === "string" ? voiceConfigId : "vc_default",
  );

  res.status(201).json({
    sessionId: session.id,
    agentId: session.agentId,
    voiceConfigId: session.voiceConfigId,
    createdAt: new Date(session.createdAt).toISOString(),
    status: session.status,
  });
});

app.get("/api/sessions/:sessionId", (req, res) => {
  const session = sessionManager.getSession(req.params.sessionId);

  if (!session) {
    const body: ApiResponse = {
      success: false,
      error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
    };
    res.status(404).json(body);
    return;
  }

  res.json({
    success: true,
    data: {
      sessionId: session.id,
      agentId: session.agentId,
      voiceConfigId: session.voiceConfigId,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
      messages: session.messages,
    },
  });
});

app.delete("/api/sessions/:sessionId", (req, res) => {
  const deleted = sessionManager.deleteSession(req.params.sessionId);

  if (!deleted) {
    const body: ApiResponse = {
      success: false,
      error: { code: "SESSION_NOT_FOUND", message: "Session not found" },
    };
    res.status(404).json(body);
    return;
  }

  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Voice routes
// ---------------------------------------------------------------------------

app.get("/api/voices", (_req, res) => {
  // Static catalog — in production this would come from MiniMax API
  res.json({
    models: [
      {
        modelId: "speech-01",
        name: "Speech-01",
        features: ["streaming", "voice_cloning"],
      },
      {
        modelId: "speech-02-turbo",
        name: "Speech-02 Turbo",
        features: ["streaming"],
      },
    ],
    voices: [
      {
        voiceId: "female_shuangkuai",
        name: "\u723D\u5FEB\u5973\u58F0",
        gender: "female",
        language: "zh-CN",
      },
      {
        voiceId: "male_chengshu",
        name: "\u6210\u719F\u7537\u58F0",
        gender: "male",
        language: "zh-CN",
      },
      {
        voiceId: "female_wennuan",
        name: "\u6E29\u6696\u5973\u58F0",
        gender: "female",
        language: "zh-CN",
      },
      {
        voiceId: "male_qingsong",
        name: "\u8F7B\u677E\u7537\u58F0",
        gender: "male",
        language: "zh-CN",
      },
    ],
  });
});

app.post("/api/voices/config", (req, res) => {
  const { modelId, voiceId, speed, volume, pitch } = req.body ?? {};

  if (!modelId || !voiceId) {
    const body: ApiResponse = {
      success: false,
      error: { code: "INVALID_REQUEST", message: "modelId and voiceId are required" },
    };
    res.status(400).json(body);
    return;
  }

  // In production, persist to DB. For now, just acknowledge.
  const configId = `vc_${Date.now()}`;
  res.status(201).json({
    success: true,
    data: {
      configId,
      modelId,
      voiceId,
      speed: typeof speed === "number" ? speed : 1.0,
      volume: typeof volume === "number" ? volume : 1.0,
      pitch: typeof pitch === "number" ? pitch : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const server = app.listen(Number(PORT), HOST, () => {
  console.log(`[backend] HTTP server listening on ${HOST}:${PORT}`);
  console.log(
    `[backend] Mock mode — OpenClaw: ${!process.env.OPENCLAW_API_KEY}, MiniMax: ${!process.env.MINIMAX_API_KEY}`,
  );
});

// Initialize WebSocket on the same HTTP server
initWebSocket(server);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
  console.log(`[backend] ${signal} received, shutting down...`);
  sessionManager.shutdown();
  server.close(() => {
    console.log("[backend] Server closed");
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
