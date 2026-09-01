/**
 * A failure that resuming cannot clear.
 *
 * `saaga run` prints a resume hint on every failed run, which is right for the
 * usual case — a crashed agent, a transient tool error — where the journal
 * lets the next attempt skip the work already done. Some failures are decided
 * by inputs the journal replays unchanged, so resuming reaches the identical
 * failure with no progress. Pointing a user at resume in that case sends them
 * in a circle, so the CLI suppresses the hint for these.
 *
 * Its own module, imported by both the CLI and the scripts that throw it, so a
 * script does not have to depend on the runner.
 */
export class NonResumableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonResumableError";
  }
}
