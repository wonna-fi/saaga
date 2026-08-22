import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/**
 * Neutral task derived from merged PR #41 (add `saaga run` command),
 * selected mechanically as one of the three most recent non-bot feature
 * PRs. See eval/README.md for the authoring caveat.
 */
export const task: EvalTask = {
  id: "neutral/pr-01-run-command",
  half: "neutral",
  title: "Where the init workflow moved",
  kind: "answer",
  prompt:
    "A user runs `saaga init .` and gets an error saying the command has moved. What exact " +
    "command should they run instead, and what is the general form of the command that " +
    "replaced the old workflow subcommands?",
  check: checkAnswer({
    must: [/saaga run init/i, /(flow)/i],
  }),
};
