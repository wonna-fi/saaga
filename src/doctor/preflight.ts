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
 */
export async function runPreflight(backend: Backend): Promise<PreflightResult> {
  const doctorResult = await runDoctor({
    backend,
    level: "fast",
  });

  return {
    passed: doctorResult.exitCode === 0,
    doctorResult,
  };
}
