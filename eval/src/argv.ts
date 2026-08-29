/**
 * Argv for the eval CLIs.
 *
 * `pnpm eval -- --reps 8` forwards the separator itself, and Node's
 * parseArgs treats everything after a bare `--` as positionals — so the
 * flags were silently dropped and the run used defaults. Drop the leading
 * separator so both `pnpm eval --reps 8` and `pnpm eval -- --reps 8` mean
 * the same thing.
 */
export function evalArgv(argv: readonly string[] = process.argv.slice(2)): string[] {
  return argv[0] === "--" ? argv.slice(1) : [...argv];
}
