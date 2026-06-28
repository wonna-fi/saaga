export type Scope = Record<string, unknown>;

export interface AgentStep {
  type: "agent";
  prompt: string;
  vars?: Record<string, string>;
  expect_file?: string;
}

export interface ScriptStep {
  type: "script";
  name: string;
  args: Record<string, string>;
  set?: string;
}

export interface ForeachStep {
  type: "foreach";
  var: string;
  in: string;
  when?: string;
  do: Step[];
}

export interface LoopStep {
  type: "loop";
  max: number;
  until: string;
  do: Step[];
}

export interface IfStep {
  type: "if";
  condition: string;
  then: Step[];
}

export interface ReadFileStep {
  type: "read-file";
  path: string;
  set: string;
  trim?: boolean;
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
  steps: Step[];
}
