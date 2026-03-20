# 实时对话 Demo — 延时优化策略

## 端到端延时链路

```
用户按下发送
  ├── [T1] Client → BFF        < 50ms
  ├── [T2] BFF 内部处理         < 10ms
  ├── [T3] BFF → OpenClaw      < 50ms
  ├── [T4] OpenClaw 首 token    < 800ms (最大瓶颈)
  ├── [T5] 句子缓冲等待         < 400ms
  ├── [T6] MiniMax TTS 首字节   < 200ms
  ├── [T7] TTS → Client 播放    < 50ms
  └── 端到端 TTFT 目标          < 1.5s
```

## 优化策略

### P0 — 必须做

1. **WebSocket 长连接复用** — 省去每次 TCP/TLS 握手
2. **OpenClaw 使用 SSE/流式接口** — 不等完整响应
3. **Sync Engine 句子级切分 + 边收边合成**
4. **MiniMax 使用流式 TTS 接口**
5. **AudioContext 预创建**（用户手势时初始化）
6. **音频 binary frame 传输**（避免 Base64 开销）

### P1 — 应该做

7. **TTS Pipeline 并发合成**（并发度 2-3）
8. **首句短切分策略**（问候语更早触发 TTS）
9. **BFF 与 OpenClaw/MiniMax 同区域部署**
10. **WebSocket per-message deflate 压缩**
11. **首个音频 chunk 跳过队列直接播放**

### P2 — 可以做

12. **BFF 内存会话存储**（零磁盘 I/O）
13. **连接预热**（onKeyPress 触发）
14. **PCM 格式优先**（省去客户端解码）
15. **文本-音频同步高亮**

## Sync Engine 缓冲策略

```typescript
// 伪代码
buffer = ""
MAX_BUFFER_SIZE = 80
SENTENCE_ENDINGS = ["。", "！", "？", ".", "!", "?", "\n"]
PHRASE_ENDINGS = ["，", ",", "；", ";"]

function onToken(token):
  buffer += token

  // 优先：检测到句子结束符
  if buffer ends with any SENTENCE_ENDINGS:
    flushToTTS(buffer)
    buffer = ""
    return

  // 兜底：缓冲过长，按短语切分
  if buffer.length > MAX_BUFFER_SIZE:
    lastPhraseEnd = findLastIndex(buffer, PHRASE_ENDINGS)
    if lastPhraseEnd > 0:
      flushToTTS(buffer[0..lastPhraseEnd])
      buffer = buffer[lastPhraseEnd+1..]
```

## 降级策略

| 场景 | 降级操作 |
|------|----------|
| Agent 响应 > 3s | 显示"思考中..."动画 |
| TTS 首字节 > 1s | 先显示文本，音频追上播放 |
| 音频 chunk 间隔 > 500ms | 短暂静音填充 |
| WebSocket 断线 | 降级为 SSE + POST |
| TTS 不可用 | 纯文本模式 |
| MiniMax 限流 | 自动降级到 turbo 模型 |

## 延时监控

| 指标 | 黄色告警 | 红色告警 |
|------|----------|----------|
| ttft_agent | > 1.5s | > 3s |
| ttft_tts | > 500ms | > 1s |
| ttft_client | > 2s | > 4s |
| ws_rtt | > 200ms | > 500ms |
