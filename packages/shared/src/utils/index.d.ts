/**
 * 生成唯一 ID
 */
export declare function generateId(): string;
/**
 * 格式化时间戳为可读字符串
 */
export declare function formatTimestamp(timestamp: number, locale?: string): string;
/**
 * 截断文本到指定长度
 */
export declare function truncate(text: string, maxLength: number): string;
/**
 * 安全的 JSON 解析
 */
export declare function safeJsonParse<T = unknown>(json: string): T | null;
/**
 * 延迟执行
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * 检查是否为浏览器环境
 */
export declare function isBrowser(): boolean;
//# sourceMappingURL=index.d.ts.map