import type { Backend } from "../cli/backend.js";
import { runDoctor, type DoctorResult } from "./index.js";

export interface PreflightResult {
  passed: boolean;
  doctorResult: DoctorResult;
}

/**
 * Run the fast-tier probes for a single backend before starting a flow.
 * Returns whether the backend is usable. Does not throw — the caller
 * decides how to handle failure.
 *
 * `models` are the model ids the run will use. Passing them lets probes that
 * check models against the account see the run's overrides, not the defaults.
 */
export async function runPreflight(
  backend: Backend,
  models?: readonly string[],
): Promise<PreflightResult> {
  const doctorResult = await runDoctor({
    backend,
    level: "fast",
    models,
  });

  return {
    passed: doctorResult.exitCode === 0,
    doctorResult,
  };
}
