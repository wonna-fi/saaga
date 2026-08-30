export type Scope = Record<string, unknown>;

export interface AgentStep {
  type: "agent";
  prompt: string;
  vars?: Record<string, string>;
  expect_file?: string;
  label?: string;
  /**
   * Model key this step asks for, resolved against the backend's models map.
   * Absent means `DEFAULT_MODEL_KEY`; the default is deliberately not filled
   * in here, so a flow omitting the key keeps the hash it had before the key
   * existed.
   */
  model?: string;
}

export interface ScriptStep {
  type: "script";
  name: string;
  args: Record<string, string>;
  set?: string;
  label?: string;
}

export interface ForeachStep {
  type: "foreach";
  var: string;
  in: string;
  when?: string;
  do: Step[];
  label?: string;
}

export interface LoopStep {
  type: "loop";
  max: number;
  until: string;
  do: Step[];
  label?: string;
}

export interface IfStep {
  type: "if";
  condition: string;
  then: Step[];
  label?: string;
  skip_label?: string;
}

export interface ReadFileStep {
  type: "read-file";
  path: string;
  set: string;
  trim?: boolean;
  label?: string;
}

export type Step =
  | AgentStep
  | ScriptStep
  | ForeachStep
  | LoopStep
  | IfStep
  | ReadFileStep;

export interface FlowDefinition {
  name: string;
  description?: string;
  steps: Step[];
}
