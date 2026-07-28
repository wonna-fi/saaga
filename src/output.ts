import { appendFileSync, closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import pc from "picocolors";

export type Marker = "DONE" | "SKIP" | "FAIL";

export interface OutputSinkOptions {
  ci?: boolean;
  stream?: NodeJS.WritableStream;
  logFile?: string;
  verbose?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 120;
const DEFAULT_MARKER_COL = 72;
const MARKER_WIDTH = 6; // [DONE], [SKIP], [FAIL]
const DURATION_PAD = 8; // " 1m42s" max
const MIN_MARKER_COL = 40;

export class OutputSink {
  private readonly ci: boolean;
  private readonly stream: NodeJS.WritableStream;
  private readonly logFile: string | undefined;
  private readonly verbose: boolean;
  private readonly isTTY: boolean;
  private readonly markerCol: number;

  private pendingLine: string | null = null;
  private pendingStartMs = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;

  constructor(opts: OutputSinkOptions = {}) {
    this.ci = opts.ci ?? false;
    this.stream = opts.stream ?? process.stderr;
    this.logFile = opts.logFile;
    this.verbose = opts.verbose ?? false;
    this.isTTY = !this.ci && isTTYStream(this.stream);
    this.markerCol = this.computeMarkerCol();
  }

  private computeMarkerCol(): number {
    if (this.isTTY) {
      const cols = getStreamColumns(this.stream);
      if (cols > 0) {
        return Math.max(MIN_MARKER_COL, Math.min(DEFAULT_MARKER_COL, cols - MARKER_WIDTH - DURATION_PAD));
      }
    }
    return DEFAULT_MARKER_COL;
  }

  phaseBegin(text: string): void {
    this.finishPendingLine();
    this.pendingLine = text;
    this.pendingStartMs = Date.now();
    this.logDetail(text);

    if (this.verbose) {
      this.stream.write(text + "\n");
    } else if (this.isTTY) {
      this.stream.write(text);
      this.startSpinner();
    } else {
      this.stream.write(text);
    }
  }

  phaseEnd(marker: Marker, durationMs: number): void {
    this.stopSpinner();
    const text = this.pendingLine ?? "";
    this.pendingLine = null;

    const markerStr = this.renderMarker(marker);
    const duration = formatDuration(durationMs);
    const padded = this.padToMarker(text);

    if (this.verbose) {
      this.stream.write(`${padded}${markerStr} ${duration}\n`);
    } else if (this.isTTY) {
      this.stream.write(`\r\x1b[K${padded}${markerStr} ${duration}\n`);
    } else {
      const suffixLen = text.length;
      const remaining = padded.slice(suffixLen);
      this.stream.write(`${remaining}${markerStr} ${duration}\n`);
    }

    this.logDetail(`${padded}${this.renderMarkerPlain(marker)} ${duration}`);
  }

  /**
   * Emit a phase line that is immediately complete (no pending state).
   * Used for [SKIP] lines and the final summary.
   */
  phaseImmediate(text: string, marker: Marker, durationMs?: number): void {
    this.finishPendingLine();
    const markerStr = this.renderMarker(marker);
    const duration = durationMs != null ? ` ${formatDuration(durationMs)}` : "";
    const padded = this.padToMarker(text);
    this.stream.write(`${padded}${markerStr}${duration}\n`);
    this.logDetail(`${padded}${this.renderMarkerPlain(marker)}${duration}`);
  }

  /**
   * Write a detailed log line. Always goes to run.log.
   * Only appears on terminal under --verbose.
   */
  detail(message: string): void {
    this.logDetail(message);
    if (this.verbose) {
      this.finishPendingLine();
      this.stream.write(`  ${message}\n`);
    }
  }

  warn(message: string): void {
    this.interruptPending();
    const tag = this.ci ? "[WARN]" : pc.yellow("[WARN]");
    this.stream.write(`${tag} ${message}\n`);
    this.logDetail(`[WARN] ${message}`);
  }

  error(message: string): void {
    this.interruptPending();
    const tag = this.ci ? "[ERROR]" : pc.red("[ERROR]");
    this.stream.write(`${tag} ${message}\n`);
    this.logDetail(`[ERROR] ${message}`);
  }

  info(message: string): void {
    this.interruptPending();
    const tag = this.ci ? "[INFO]" : pc.green("[INFO]");
    this.stream.write(`${tag} ${message}\n`);
    this.logDetail(`[INFO] ${message}`);
  }

  /**
   * Read the last N lines from the log file starting at `fromByte`.
   * Returns the tail text, or null if the file can't be read.
   */
  tailLog(fromByte: number, maxLines = 20): string | null {
    if (!this.logFile) return null;
    try {
      const fd = openSync(this.logFile, "r");
      try {
        const st = fstatSync(fd);
        if (st.size <= fromByte) return null;
        const length = st.size - fromByte;
        const buf = Buffer.alloc(length);
        readSync(fd, buf, 0, length, fromByte);
        const added = buf.toString("utf8");
        const lines = added.split("\n");
        const tail = lines.slice(-maxLines - 1).join("\n");
        return tail.trim() || null;
      } finally {
        closeSync(fd);
      }
    } catch {
      return null;
    }
  }

  logFileSize(): number {
    if (!this.logFile) return 0;
    try {
      return statSync(this.logFile).size;
    } catch {
      return 0;
    }
  }

  dispose(): void {
    this.stopSpinner();
  }

  private logDetail(message: string): void {
    if (!this.logFile) return;
    try {
      appendFileSync(this.logFile, message + "\n");
    } catch {
      // best-effort
    }
  }

  private padToMarker(text: string): string {
    const stripped = stripAnsi(text);
    if (stripped.length >= this.markerCol) {
      const truncated = truncateText(text, stripped, this.markerCol - 1);
      return truncated + " ";
    }
    return text + " ".repeat(this.markerCol - stripped.length);
  }

  private renderMarker(marker: Marker): string {
    if (this.ci || !this.isTTY) {
      return this.renderMarkerPlain(marker);
    }
    switch (marker) {
      case "DONE":
        return pc.green("[DONE]");
      case "SKIP":
        return pc.dim("[SKIP]");
      case "FAIL":
        return pc.red("[FAIL]");
    }
  }

  private renderMarkerPlain(marker: Marker): string {
    return `[${marker}]`;
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerFrame = 0;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      const frame = SPINNER_FRAMES[this.spinnerFrame];
      const elapsed = formatDuration(Date.now() - this.pendingStartMs);
      this.stream.write(`\r\x1b[K${this.pendingLine} ${pc.dim(`${frame} ${elapsed}`)}`);
    }, SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  private interruptPending(): void {
    if (this.pendingLine != null && !this.verbose) {
      this.stopSpinner();
      if (this.isTTY) {
        this.stream.write("\n");
      } else {
        this.stream.write("\n");
      }
    }
  }

  private finishPendingLine(): void {
    if (this.pendingLine != null && !this.verbose) {
      this.stopSpinner();
      if (this.isTTY) {
        this.stream.write("\r\x1b[K");
      } else {
        this.stream.write("\n");
      }
      this.pendingLine = null;
    }
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

/**
 * Truncate the label portion of a phase line to fit within the marker column.
 * Preserves the prefix (Phase N/M: ) and the suffix ((iteration i/k)).
 */
export function truncateLabel(
  prefix: string,
  label: string,
  suffix: string,
  maxWidth: number,
): string {
  const full = prefix + label + suffix;
  if (stripAnsi(full).length <= maxWidth) {
    return full;
  }
  const available = maxWidth - stripAnsi(prefix).length - stripAnsi(suffix).length - 1; // 1 for ellipsis
  if (available < 3) {
    return prefix + "..." + suffix;
  }
  return prefix + label.slice(0, available) + "\u2026" + suffix;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * Truncate a phase line to maxLen characters, preserving as much of the
 * end (iteration suffix) as possible. Operates on the pre-padded text.
 */
function truncateText(text: string, stripped: string, maxLen: number): string {
  if (stripped.length <= maxLen) return text;
  // Try to keep the "(iteration i/k)" suffix visible
  const iterMatch = /( \(iteration \d+\/\d+\))$/.exec(stripped);
  if (iterMatch) {
    const suffix = iterMatch[1];
    const prefixMaxLen = maxLen - suffix.length - 1; // 1 for ellipsis
    if (prefixMaxLen > 10) {
      // Find where the suffix starts in the original text (may have ANSI codes)
      const suffixStart = text.lastIndexOf(suffix);
      if (suffixStart >= 0) {
        return text.slice(0, prefixMaxLen) + "\u2026" + suffix;
      }
    }
  }
  return text.slice(0, maxLen - 1) + "\u2026";
}

function isTTYStream(stream: NodeJS.WritableStream): boolean {
  return "isTTY" in stream && (stream as NodeJS.WriteStream).isTTY === true;
}

function getStreamColumns(stream: NodeJS.WritableStream): number {
  if ("columns" in stream) {
    return (stream as NodeJS.WriteStream).columns ?? 0;
  }
  return 0;
}
