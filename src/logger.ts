import { Writable } from "node:stream";
import { type Marker, OutputSink, type OutputSinkOptions } from "./output.js";

export interface LoggerOptions {
  ci?: boolean;
  stream?: NodeJS.WritableStream;
  /**
   * Number of spaces prepended to every line (after the `[LEVEL]` tag).
   * Used to indent log lines emitted from inside nested flow primitives
   * (`foreach`, `loop`, `if`). Defaults to 0.
   */
  indent?: number;
  logFile?: string;
  verbose?: boolean;
}

export class Logger {
  private readonly sink: OutputSink;
  private readonly ci: boolean;
  private readonly indent: number;

  constructor(opts: LoggerOptions = {}) {
    this.ci = opts.ci ?? false;
    this.indent = opts.indent ?? 0;
    this.sink = new OutputSink({
      ci: opts.ci,
      stream: opts.stream,
      logFile: opts.logFile,
      verbose: opts.verbose,
    } satisfies OutputSinkOptions);
  }

  /** Create a Logger wrapping an existing OutputSink (shared state). */
  static fromSink(sink: OutputSink, opts: { ci?: boolean; indent?: number } = {}): Logger {
    const logger = Object.create(Logger.prototype) as Logger;
    Object.defineProperty(logger, "sink", { value: sink, writable: false });
    Object.defineProperty(logger, "ci", { value: opts.ci ?? false, writable: false });
    Object.defineProperty(logger, "indent", { value: opts.indent ?? 0, writable: false });
    return logger;
  }

  info(message: string): void {
    const pad = this.indent > 0 ? " ".repeat(this.indent) : "";
    this.sink.info(`${pad}${message}`);
  }

  warn(message: string): void {
    const pad = this.indent > 0 ? " ".repeat(this.indent) : "";
    this.sink.warn(`${pad}${message}`);
  }

  error(message: string): void {
    const pad = this.indent > 0 ? " ".repeat(this.indent) : "";
    this.sink.error(`${pad}${message}`);
  }

  phaseBegin(text: string): void {
    this.sink.phaseBegin(text);
  }

  phaseEnd(marker: Marker, durationMs: number): void {
    this.sink.phaseEnd(marker, durationMs);
  }

  phaseImmediate(text: string, marker: Marker, durationMs?: number): void {
    this.sink.phaseImmediate(text, marker, durationMs);
  }

  detail(message: string): void {
    this.sink.detail(message);
  }

  logFileSize(): number {
    return this.sink.logFileSize();
  }

  tailLog(fromByte: number, maxLines?: number): string | null {
    return this.sink.tailLog(fromByte, maxLines);
  }

  /**
   * Returns a new logger that shares the underlying OutputSink
   * but indents detail lines by `extraIndent` additional spaces.
   */
  child(extraIndent = 2): Logger {
    return Logger.fromSink(this.sink, {
      ci: this.ci,
      indent: this.indent + extraIndent,
    });
  }

  getSink(): OutputSink {
    return this.sink;
  }

  dispose(): void {
    this.sink.dispose();
  }
}

let _silentSink: OutputSink | null = null;
function silentSink(): OutputSink {
  if (_silentSink) return _silentSink;
  const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  _silentSink = new OutputSink({ stream: sink });
  return _silentSink;
}

export function silentLogger(): Logger {
  return Logger.fromSink(silentSink());
}
