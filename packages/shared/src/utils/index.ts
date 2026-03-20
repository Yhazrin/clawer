/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 格式化时间戳为可读字符串
 */
export function formatTimestamp(timestamp: number, locale = "zh-CN"): string {
  return new Date(timestamp).toLocaleString(locale);
}

/**
 * 截断文本到指定长度
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse<T = unknown>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 检查是否为浏览器环境
 */
export function isBrowser(): boolean {
  return typeof globalThis !== "undefined"
    && "window" in globalThis
    && "document" in globalThis;
}
