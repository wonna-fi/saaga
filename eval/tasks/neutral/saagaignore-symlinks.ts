import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Depth-preservation probe: ignore layering + symlink hashing. */
export const task: EvalTask = {
  id: "neutral/saagaignore-symlinks",
  half: "neutral",
  title: "Ignore-file layering and symlink hashing",
  kind: "answer",
  prompt:
    "Two questions about saaga's ignore and hashing behavior. First: write ignore-file " +
    "content that excludes everything under `build/` except `build/keep.txt`. Second: when " +
    "saaga hashes a symlink for BASELINE, what exactly is hashed?",
  check: checkAnswer({
    must: [
      /!.*keep\.txt/,
      /(link.?target|target (string|path))/i,
      /(never|not).{0,60}(travers|follow|derefer)/i,
    ],
  }),
};
