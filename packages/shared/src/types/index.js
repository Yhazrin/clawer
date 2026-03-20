/** WebSocket 消息事件枚举 */
export var WSEvent;
(function (WSEvent) {
    // 客户端 -> 服务端
    WSEvent["CONNECT"] = "connect";
    WSEvent["DISCONNECT"] = "disconnect";
    WSEvent["SEND_MESSAGE"] = "send_message";
    WSEvent["STOP_GENERATION"] = "stop_generation";
    WSEvent["TTS_REQUEST"] = "tts_request";
    // 服务端 -> 客户端
    WSEvent["MESSAGE_START"] = "message_start";
    WSEvent["MESSAGE_CHUNK"] = "message_chunk";
    WSEvent["MESSAGE_END"] = "message_end";
    WSEvent["MESSAGE_ERROR"] = "message_error";
    WSEvent["TTS_AUDIO"] = "tts_audio";
    WSEvent["SESSION_UPDATE"] = "session_update";
    WSEvent["AGENT_STATUS"] = "agent_status";
})(WSEvent || (WSEvent = {}));
//# sourceMappingURL=index.js.map