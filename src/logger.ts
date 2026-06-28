import pc from "picocolors";

export interface LoggerOptions {
  /**
   * In CI mode the output is plain text (no ANSI colors). Mirrors the
   * `--ci` flag and matches the format produced by the legacy bash
   * helpers (`run.sh::log_info`, etc.).
   */
  ci?: boolean;
  /** Stream override (used by tests). */
  stream?: NodeJS.WritableStream;
  /**
   * Number of spaces prepended to every line (after the `[LEVEL]` tag).
   * Used to indent log lines emitted from inside nested flow primitives
   * (`foreach`, `loop`, `if`). Defaults to 0.
   */
  indent?: number;
}

export class Logger {
  private readonly ci: boolean;
  private readonly stream: NodeJS.WritableStream;
  private readonly indent: number;

  constructor(opts: LoggerOptions = {}) {
    this.ci = opts.ci ?? false;
    this.stream = opts.stream ?? process.stderr;
    this.indent = opts.indent ?? 0;
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  /**
   * Returns a new logger that shares the underlying stream and ci/color
   * settings but indents every line by `extraIndent` additional spaces.
   * Use to nest log output one level deeper, e.g. inside a `foreach`
   * iteration body or a `loop` iteration.
   */
  child(extraIndent = 2): Logger {
    return new Logger({
      ci: this.ci,
      stream: this.stream,
      indent: this.indent + extraIndent,
    });
  }

  private write(level: "INFO" | "WARN" | "ERROR", message: string): void {
    const tag = this.ci ? `[${level}]` : this.colorTag(level);
    const pad = this.indent > 0 ? " ".repeat(this.indent) : "";
    this.stream.write(`${tag} ${pad}${message}\n`);
  }

  private colorTag(level: "INFO" | "WARN" | "ERROR"): string {
    switch (level) {
      case "INFO":
        return pc.green("[INFO]");
      case "WARN":
        return pc.yellow("[WARN]");
      case "ERROR":
        return pc.red("[ERROR]");
    }
  }
}
