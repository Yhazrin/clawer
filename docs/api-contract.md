# 实时对话 Demo — API 契约文档

## 概述

Base URL:
- REST API: `http://localhost:3001/api`
- WebSocket: `ws://localhost:3001/ws`

---

## REST API

### 会话管理

#### POST /api/sessions
创建新会话。

Request:
```json
{ "agentId": "agent_abc123", "voiceConfigId": "vc_default" }
```

Response `201`:
```json
{
  "sessionId": "sess_xxx",
  "agentId": "agent_abc123",
  "voiceConfigId": "vc_default",
  "createdAt": "2026-03-20T10:00:00.000Z",
  "status": "active"
}
```

#### GET /api/sessions/:sessionId
获取会话详情及历史消息。

#### DELETE /api/sessions/:sessionId
结束会话，释放资源。`204 No Content`

---

### 音色管理

#### GET /api/voices
获取可用 TTS 模型和音色列表。

Response `200`:
```json
{
  "models": [
    { "modelId": "speech-01", "name": "Speech-01", "features": ["streaming", "voice_cloning"] },
    { "modelId": "speech-02-turbo", "name": "Speech-02 Turbo", "features": ["streaming"] }
  ],
  "voices": [
    { "voiceId": "female_shuangkuai", "name": "爽快女声", "gender": "female", "language": "zh-CN" },
    { "voiceId": "male_chengshu", "name": "成熟男声", "gender": "male", "language": "zh-CN" }
  ]
}
```

#### POST /api/voices/config
保存音色配置。

Request:
```json
{ "modelId": "speech-01", "voiceId": "female_shuangkuai", "speed": 1.0, "volume": 1.0, "pitch": 0 }
```

#### POST /api/voices/clone
音色复刻。`Content-Type: multipart/form-data`，上传参考音频。

---

## WebSocket 协议

### 连接
```
ws://localhost:3001/ws?sessionId=sess_xxx
```

### 统一消息格式
```typescript
interface WSMessage<T = unknown> {
  type: string;
  payload: T;
  messageId?: string;
  timestamp: number;
}
```

### 客户端 → 服务端

| type | payload | 说明 |
|------|---------|------|
| `user_message` | `{ text, sessionId, messageId }` | 用户发送消息 |
| `session_resume` | `{ sessionId, lastSeqId }` | 断线重连恢复 |
| `voice_change` | `{ voiceConfigId }` | 切换音色 |
| `audio_control` | `{ action: "pause"\|"resume"\|"stop"\|"skip" }` | 音频控制 |
| `ping` | `{}` | 心跳 |

### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `text_chunk` | `{ text, messageId, seqId, isFinal }` | Agent 文本流分片 |
| `audio_chunk` | `{ audio(base64), format, sampleRate, seqId, isFinal }` | TTS 音频分片 |
| `audio_meta` | `{ messageId, format, sampleRate, channels }` | 音频流元信息 |
| `agent_status` | `{ status, messageId?, error? }` | Agent 状态通知 |
| `pong` | `{ serverTime }` | 心跳响应 |
| `session_resumed` | `{ sessionId, missedMessages[] }` | 会话恢复确认 |

### 音频 Binary Frame（优先）
```
[0-3]   seqId (uint32, big-endian)
[4]     flags (uint8: bit 0 = isFinal)
[5...]  audio data (PCM 16-bit LE)
```
默认 PCM: 24000Hz, 16-bit, mono。

---

## TypeScript 类型

共享类型定义在 `packages/shared/src/types/index.ts`，包含 Message, Session, AgentConfig, TTSConfig, VoiceOption, WSEvent, WSMessage, ApiResponse 等。

---

## 错误码

| HTTP | 错误码 | 说明 |
|------|--------|------|
| 400 | `INVALID_REQUEST` | 参数校验失败 |
| 401 | `UNAUTHORIZED` | 认证失败 |
| 404 | `SESSION_NOT_FOUND` | 会话不存在 |
| 429 | `RATE_LIMITED` | 频率超限 |
| 502 | `AGENT_ERROR` | OpenClaw 返回错误 |
| 502 | `TTS_ERROR` | MiniMax 返回错误 |

WS Close Codes: 4000=会话不存在, 4001=认证失败, 4002=会话已结束, 4003=心跳超时
