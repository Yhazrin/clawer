/**
 * Sync Engine — text/audio sentence-level chunking.
 *
 * Receives tokens from the Agent Bridge and splits them at semantic boundaries
 * (sentence-ending punctuation).  Completed sentences are forwarded to the TTS
 * Pipeline via the onSentence callback.  Every token is forwarded to the client
 * via the onToken callback for real-time typewriter rendering.
 */

/** Sentence-ending characters (Chinese + English) */
const SENTENCE_ENDINGS = /[。！？.!?]/;

/** Fallback split characters when buffer exceeds MAX_BUFFER without a sentence ending */
const FALLBACK_SPLITS = /[,，；;、]/;
const MAX_BUFFER = 80;

export type OnSentence = (sentence: string) => void;
export type OnToken = (token: string) => void;

export class SyncEngine {
  private buffer = "";
  private onSentence: OnSentence;
  private onToken: OnToken;

  constructor(opts: { onSentence: OnSentence; onToken: OnToken }) {
    this.onSentence = opts.onSentence;
    this.onToken = opts.onToken;
  }

  /**
   * Receive a single token from the Agent Bridge.
   * Internally accumulates text and flushes at sentence boundaries.
   */
  receiveToken(token: string): void {
    // Forward every token immediately for typewriter effect
    this.onToken(token);

    this.buffer += token;

    // Try sentence-level split
    this.tryFlushByPunctuation();

    // Fallback: buffer too long, split at comma / semicolon
    if (this.buffer.length > MAX_BUFFER) {
      this.tryFlushByFallback();
    }
  }

  /**
   * Signal that the Agent has finished streaming.
   * Flush any remaining buffer as the final sentence.
   */
  flush(): void {
    if (this.buffer.length > 0) {
      this.onSentence(this.buffer);
      this.buffer = "";
    }
  }

  // -----------------------------------------------------------------------

  private tryFlushByPunctuation(): void {
    const idx = this.findLastMatch(this.buffer, SENTENCE_ENDINGS);
    if (idx === -1) return;
    const sentence = this.buffer.slice(0, idx + 1);
    this.buffer = this.buffer.slice(idx + 1);
    this.onSentence(sentence);
  }

  private tryFlushByFallback(): void {
    const idx = this.findLastMatch(this.buffer, FALLBACK_SPLITS);
    if (idx === -1) {
      // No fallback split found — force-flush entire buffer
      this.onSentence(this.buffer);
      this.buffer = "";
      return;
    }
    const sentence = this.buffer.slice(0, idx + 1);
    this.buffer = this.buffer.slice(idx + 1);
    this.onSentence(sentence);
  }

  /** Return the index of the last character matching `re`, or -1. */
  private findLastMatch(str: string, re: RegExp): number {
    let last = -1;
    for (let i = 0; i < str.length; i++) {
      if (re.test(str[i])) last = i;
    }
    return last;
  }
}
