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

export type OnSentence = (sentence: string) => Promise<void> | void;
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
   * Returns any pending onSentence promise (for caller to collect).
   */
  receiveToken(token: string): Promise<void> | void {
    // Forward every token immediately for typewriter effect
    this.onToken(token);

    this.buffer += token;

    // Try sentence-level split
    const idx = this.findLastMatch(this.buffer, SENTENCE_ENDINGS);
    if (idx !== -1) {
      const sentence = this.buffer.slice(0, idx + 1);
      this.buffer = this.buffer.slice(idx + 1);
      return this.onSentence(sentence);
    }

    // Fallback: buffer too long, split at comma / semicolon
    if (this.buffer.length > MAX_BUFFER) {
      const fIdx = this.findLastMatch(this.buffer, FALLBACK_SPLITS);
      if (fIdx === -1) {
        const sentence = this.buffer;
        this.buffer = "";
        return this.onSentence(sentence);
      }
      const sentence = this.buffer.slice(0, fIdx + 1);
      this.buffer = this.buffer.slice(fIdx + 1);
      return this.onSentence(sentence);
    }
  }

  /**
   * Signal that the Agent has finished streaming.
   * Flush any remaining buffer as the final sentence.
   */
  flush(): Promise<void> | void {
    if (this.buffer.length > 0) {
      const result = this.onSentence(this.buffer);
      this.buffer = "";
      return result;
    }
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
