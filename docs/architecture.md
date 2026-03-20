# 实时对话 Demo — 系统架构文档

## 1. 项目概述

构建一个展示型实时对话 Demo，核心体验是"Agent 真的在和人自然交流"。用户通过 Web/App 发送消息，Agent 流式生成文本回复，同时通过 MiniMax TTS 实时合成语音，实现"边生成、边说话、边展示"的沉浸式交互。

## 2. 系统拓扑

```
+---------------------------------------------------------------------+
|                          Client Layer                                |
|  +------------------------+     +-------------------------------+   |
|  |   Web App (Next.js)    |     |  Mobile App (React Native)    |   |
|  |   - React 19           |     |  - Expo SDK 52+               |   |
|  |   - AudioContext       |     |  - expo-av for audio          |   |
|  |   - WebSocket client   |     |  - WebSocket client           |   |
|  +-----------+------------+     +--------------+----------------+   |
|              +-------------+-------------------+                    |
|                            |  WebSocket (wss://)                    |
+----------------------------+----------------------------------------+
                             |
+----------------------------+----------------------------------------+
|                       BFF Layer (services/backend)                   |
|                 +----------+---------+                              |
|                 |  WebSocket Server  |  (Express + ws)              |
|                 | +----------------+ |                              |
|                 | | Session Mgr    | |  session lifecycle mgmt     |
|                 | +----------------+ |                              |
|                 | | Agent Bridge   | |  OpenClaw Gateway client    |
|                 | +----------------+ |                              |
|                 | | TTS Pipeline   | |  MiniMax TTS client         |
|                 | +----------------+ |                              |
|                 | | Sync Engine    | |  text-audio synchronizer    |
|                 | +----------------+ |                              |
|                 +---+---------+------+                              |
+---------------------+---------+-------------------------------------+
                      |         |
+---------------------+---------+-------------------------------------+
|                 External Services                                   |
|        +------------+--+  +--+-------------------+                  |
|        | OpenClaw      |  | MiniMax TTS API      |                  |
|        | Gateway       |  | - speech-01/02-turbo |                  |
|        | - HTTP/SSE    |  | - Voice cloning      |                  |
|        | - WebSocket   |  | - Stream synthesis   |                  |
|        +---------------+  +----------------------+                  |
+---------------------------------------------------------------------+
```

## 3. Monorepo 目录结构

```
clawer/
├── apps/
│   ├── web/                    # Next.js 15 前端应用
│   │   ├── app/                # App Router
│   │   └── package.json
│   └── mobile/                 # React Native (Expo) 移动端
│       └── package.json
├── packages/
│   ├── shared/                 # 共享 TypeScript 类型与工具函数
│   ├── minimax-tts/            # MiniMax TTS SDK 封装
│   └── openclaw/               # OpenClaw Agent 客户端封装
├── services/
│   └── backend/                # BFF 服务 (Express + WebSocket)
│       └── src/
│           ├── index.ts        # HTTP 入口
│           ├── ws.ts           # WebSocket 处理器
│           ├── agent-bridge.ts # OpenClaw 接入
│           ├── tts-pipeline.ts # MiniMax TTS 封装
│           └── sync-engine.ts  # 文本-音频同步引擎
└── docs/
```

## 4. 模块职责

### 4.1 Client Layer

| 模块 | 职责 | 关键技术 |
|------|------|----------|
| Web App | 用户界面、消息渲染、音频播放 | Next.js 15, React 19, AudioContext |
| Mobile App | 跨平台移动端体验 | Expo, expo-av, WebSocket |

### 4.2 BFF Layer

| 模块 | 职责 |
|------|------|
| WebSocket Server | 管理客户端长连接、心跳、消息路由 |
| Session Manager | 创建/销毁会话、维护上下文、超时清理 |
| Agent Bridge | 对接 OpenClaw Gateway，统一输出文本流 |
| TTS Pipeline | 对接 MiniMax TTS，流式文本→流式音频 |
| Sync Engine | 按语义边界切分文本，协调渲染和播放时序 |

### 4.3 外部服务

| 服务 | 接入方式 | 用途 |
|------|----------|------|
| OpenClaw Gateway | HTTP API + SSE/WebSocket | Agent 对话流式响应 |
| MiniMax TTS | HTTP API + WebSocket | 语音合成，支持流式 |

## 5. 数据流设计

### 5.1 完整消息链路

```
用户输入
  v
[Client] WS: { type: "user_message", payload: { text, sessionId } }
  v
[BFF: WS Server] 接收，路由到对应会话
  v
[BFF: Session Mgr] 追加到会话历史
  v
[BFF: Agent Bridge] 调用 OpenClaw Gateway (SSE/WS 流式)
  v
[BFF: Agent Bridge] 逐 token 收到文本流
  |
  +---> [Sync Engine] 按句子边界切分 → 每句立即送 TTS Pipeline
  |                                    |
  |                                    v
  |                          [TTS Pipeline] MiniMax 流式合成
  |                                    |
  +---> WS: text_chunk                 +---> WS: audio_chunk (binary)
  v                                    v
[Client] 打字机效果渲染            [Client] AudioContext 排队播放
  +----------- 同步高亮当前播报文字 ---------+
```

### 5.2 Sync Engine 同步策略

**核心：按语义边界切分，边收边合成（Sentence-Level Chunking）**

```
Agent 输出:  "你好。我是你的AI助手。有什么可以帮你的？"

Token 流:    "你" "好" "。" "我是" "你" "的" "AI" "助手" "。" ...

Sync Engine 切分:
  切片 1: "你好。"              → 立即送 TTS → 音频 chunk 1, 2, 3...
  切片 2: "我是你的AI助手。"    → 立即送 TTS → 音频 chunk 4, 5, 6...
  切片 3: "有什么可以帮你的？"  → 立即送 TTS → ...

客户端:
  文本: 实时打字机效果，逐 token 渲染
  音频: chunk 到达即播放，无缝衔接
```

## 6. 技术选型

### 6.1 WebSocket 为主通道（非 SSE）

原因：
1. 需要双向通信（发送消息 + 接收文本流 + 接收音频流）
2. 二进制音频用 WS binary frame 传输比 SSE+Base64 高效 33%
3. React Native 对 WebSocket 原生支持完善

### 6.2 AudioContext 流式播放

- `<audio>` 标签需要完整文件/MediaSource，不适合流式 chunk
- AudioContext 精确控制每个 chunk 播放时序，支持无缝拼接

### 6.3 延时预算（P50 目标 < 1.5s）

| 阶段 | 目标延时 |
|------|----------|
| Client → BFF | < 50ms |
| BFF → OpenClaw 首 token | < 800ms |
| 句子完成 → TTS 首字节 | < 300ms |
| TTS → Client 播放 | < 100ms |
| **端到端 TTFT** | **< 1.5s** |

## 7. 架构决策记录

| # | 决策 | 理由 |
|---|------|------|
| ADR-001 | WebSocket 为主通道 | 双向通信 + 二进制传输 |
| ADR-002 | BFF 独立于 Next.js | RN 无法调用 Next.js API Routes |
| ADR-003 | 句子级 TTS 同步 | 平衡延时和语音质量 |
| ADR-004 | AudioContext 流式播放 | 精确时序控制 + 无缝拼接 |
| ADR-005 | 会话状态在 BFF | Agent 上下文需服务端维护 |
