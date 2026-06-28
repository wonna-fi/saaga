import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface FakeAgentCall {
  prompt: string;
  cwd: string;
}

export interface FakeScenarioValue {
  exitCode: number;
  /**
   * Optional side effect run AFTER the call is recorded but BEFORE the
   * result is returned. Lets tests simulate the agent writing files.
   */
  effect?: (opts: AgentRunOpts, prompt: string) => void | Promise<void>;
}

export type FakeScenario = Record<string, AgentRunResult | FakeScenarioValue>;

/**
 * Test double that returns canned results keyed by substring match against the prompt.
 * Records every call for later assertion.
 */
export class FakeAgent implements Agent {
  readonly name = "fake";
  readonly calls: FakeAgentCall[] = [];
  private readonly scenarios: FakeScenario;

  constructor(scenarios: FakeScenario) {
    this.scenarios = scenarios;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    this.calls.push({ prompt, cwd: opts.cwd });

    for (const [substring, scenario] of Object.entries(this.scenarios)) {
      if (prompt.includes(substring)) {
        const value = scenario as FakeScenarioValue;
        if (value.effect) {
          await value.effect(opts, prompt);
        }
        return { exitCode: value.exitCode };
      }
    }

    throw new Error(
      `FakeAgent: no scenario matched prompt (first 120 chars): ${prompt.slice(0, 120)}`,
    );
  }
}
