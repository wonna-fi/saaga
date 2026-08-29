import { stripAnsi } from "./checks.js";
import type { EvalRunSummary, TaskResult } from "./types.js";

/**
 * Build the self-contained HTML readout from committed run summaries.
 *
 * The page is a rendering of `eval/reports/*.summary.json` and nothing
 * else: every number it shows is regenerable from the committed data, so
 * comparing an old corpus against a regenerated one never involves
 * hand-copying figures into a document.
 */

/** Per-run payload the template's client-side app consumes. */
export interface ArtifactRun {
  id: string;
  label: string;
  backend: string;
  model: string;
  modelKey: string;
  rev: string;
  conditions: string[];
  reps: number;
  taskSetVersion?: number;
  startedAt: string;
  taskIds: string[];
  results: ArtifactResult[];
}

export interface ArtifactResult {
  taskId: string;
  half: string;
  /** "answer" | "code", resolved from the task registry (not in summaries). */
  kind?: string;
  condition: string;
  rep: number;
  pass: boolean;
  exitCode: number;
  checkDetail?: string;
  error?: string;
  elapsedMs: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  docsReads?: number;
}

export interface ArtifactData {
  runs: ArtifactRun[];
}

const DATA_TAG_OPEN = '<script id="eval-data" type="application/json">';
const DATA_TAG_CLOSE = "</script>";

/**
 * A run's identity in one line: the selector labels and the compare-mode
 * "base → candidate" strip are the only place a reader disambiguates two
 * runs, so date, tier and arms all have to be visible there.
 */
export function runLabel(summary: EvalRunSummary): string {
  const { spec } = summary;
  const when = spec.startedAt.slice(0, 16).replace("T", " ");
  return `${when}Z · ${spec.backend}/${spec.modelKey} · ${spec.conditions.join("+")} · v${String(spec.taskSetVersion ?? 1)}`;
}

/** Stable, filename-independent id: two runs of the same tier differ by start time. */
function runId(summary: EvalRunSummary): string {
  return `${summary.spec.startedAt.replace(/[:.]/g, "-")}-${summary.spec.modelKey}`;
}

function compact(result: TaskResult, kinds: ReadonlyMap<string, string>): ArtifactResult {
  const { metrics } = result;
  return {
    taskId: result.taskId,
    half: result.half,
    kind: kinds.get(result.taskId),
    condition: result.condition,
    rep: result.rep,
    pass: result.pass,
    exitCode: result.exitCode,
    // Baselines recorded before the checker stripped colors carry raw
    // escapes; strip on the way into the page so the hover that explains a
    // red cell reads as text rather than as a vitest color sequence.
    checkDetail: result.checkDetail === undefined ? undefined : stripAnsi(result.checkDetail),
    error: result.error === undefined ? undefined : stripAnsi(result.error),
    elapsedMs: metrics.elapsedMs,
    turns: metrics.turns,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    cacheCreationTokens: metrics.cacheCreationTokens,
    costUsd: metrics.costUsd,
    docsReads: metrics.docsReads,
  };
}

/**
 * Compact summaries into the page payload, oldest run first — the app
 * defaults compare mode to first-as-base, last-as-candidate, which is the
 * old-corpus-vs-regenerated-corpus reading.
 */
export function toArtifactData(
  summaries: readonly EvalRunSummary[],
  taskKinds: ReadonlyMap<string, string> = new Map(),
): ArtifactData {
  const runs = [...summaries]
    .sort((a, b) => a.spec.startedAt.localeCompare(b.spec.startedAt))
    .map((summary) => ({
      id: runId(summary),
      label: runLabel(summary),
      backend: summary.spec.backend,
      model: summary.spec.model,
      modelKey: summary.spec.modelKey,
      rev: summary.spec.rev,
      conditions: [...summary.spec.conditions],
      reps: summary.spec.reps,
      taskSetVersion: summary.spec.taskSetVersion,
      startedAt: summary.spec.startedAt,
      taskIds: [...summary.spec.taskIds],
      results: summary.results.map((r) => compact(r, taskKinds)),
    }));
  return { runs };
}

/**
 * Inject the payload into the template's data island.
 *
 * `</script>` inside the JSON would close the island early; escaping the
 * slash keeps the string identical after JSON.parse. U+2028/2029 are
 * valid JSON but were historically invalid in JS source, so they are
 * escaped too.
 */
export function renderArtifact(template: string, data: ArtifactData): string {
  const start = template.indexOf(DATA_TAG_OPEN);
  if (start === -1) throw new Error('template is missing the <script id="eval-data"> data island');
  const from = start + DATA_TAG_OPEN.length;
  const end = template.indexOf(DATA_TAG_CLOSE, from);
  if (end === -1) throw new Error("template data island is not closed");

  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return template.slice(0, from) + json + template.slice(end);
}
