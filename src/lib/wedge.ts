/**
 * Global barcode-wedge detection.
 *
 * USB scanners act as keyboards and "type" the whole code in a burst
 * (typically < 30 ms between characters) ending with Enter. We buffer
 * keystrokes and, when a burst of at least `minLength` characters ends with
 * Enter within `maxIntervalMs` per key, treat it as a scan rather than typing.
 */
export interface WedgeOptions {
  minLength?: number;
  maxIntervalMs?: number;
  /** Total time budget for a scan from first char to Enter */
  maxTotalMs?: number;
}

export interface WedgeEvent {
  code: string;
  durationMs: number;
}

export class WedgeDetector {
  private buffer = "";
  private firstAt = 0;
  private lastAt = 0;
  private readonly minLength: number;
  private readonly maxIntervalMs: number;
  private readonly maxTotalMs: number;

  constructor(opts: WedgeOptions = {}) {
    this.minLength = opts.minLength ?? 6;
    this.maxIntervalMs = opts.maxIntervalMs ?? 40;
    this.maxTotalMs = opts.maxTotalMs ?? 1500;
  }

  /**
   * Feed a key. Returns a WedgeEvent when a scan completes, or null.
   * `key` is the KeyboardEvent.key value; `now` is a monotonic timestamp in ms.
   */
  feed(key: string, now: number): WedgeEvent | null {
    if (key === "Enter" || key === "Tab") {
      const result = this.complete(now);
      this.reset();
      return result;
    }
    if (key.length !== 1) {
      // modifier / navigation key breaks the burst
      if (key !== "Shift") this.reset();
      return null;
    }
    if (this.buffer.length > 0 && now - this.lastAt > this.maxIntervalMs) {
      this.reset();
    }
    if (this.buffer.length === 0) this.firstAt = now;
    this.buffer += key;
    this.lastAt = now;
    return null;
  }

  /** True while a burst that could still become a scan is in progress. */
  get pending(): string {
    return this.buffer;
  }

  private complete(now: number): WedgeEvent | null {
    if (this.buffer.length < this.minLength) return null;
    if (now - this.lastAt > this.maxIntervalMs * 3) return null;
    const durationMs = now - this.firstAt;
    if (durationMs > this.maxTotalMs) return null;
    // a human typing 6+ chars averages > 80ms/char; a scanner is far faster
    if (durationMs / this.buffer.length > this.maxIntervalMs) return null;
    return { code: this.buffer, durationMs };
  }

  reset(): void {
    this.buffer = "";
    this.firstAt = 0;
    this.lastAt = 0;
  }
}
