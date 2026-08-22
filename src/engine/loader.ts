import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { FLOWS_DIR } from "../paths.js";
import type {
  AgentStep,
  FlowDefinition,
  ForeachStep,
  IfStep,
  LoopStep,
  ReadFileStep,
  ScriptStep,
  Step,
} from "./types.js";

export async function loadFlow(name: string): Promise<FlowDefinition> {
  const path = resolve(FLOWS_DIR, `${name}.flow.yaml`);
  return loadFlowFromFile(path);
}

export async function loadFlowFromFile(path: string): Promise<FlowDefinition> {
  const content = await readFile(path, "utf8");
  const raw: unknown = parseYaml(content);
  return parseFlowDefinition(raw);
}

export function parseFlowDefinition(raw: unknown): FlowDefinition {
  if (!raw || typeof raw !== "object") {
    throw new Error("Flow definition must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const name = obj.name;
  if (typeof name !== "string") {
    throw new Error("Flow 'name' must be a string");
  }
  const description = obj.description;
  if (description !== undefined && typeof description !== "string") {
    throw new Error("Flow 'description' must be a string");
  }
  const steps = obj.steps;
  if (!Array.isArray(steps)) {
    throw new Error("Flow 'steps' must be an array");
  }
  return {
    name,
    ...(description !== undefined && { description }),
    steps: steps.map(parseStep),
  };
}

function parseStep(raw: unknown): Step {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Step must be an object with one primitive key");
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);

  // The `if` primitive uses a multi-key form: `if:` + `then:` plus
  // optional `label:` and `skip_label:`.
  if ("if" in obj && "then" in obj) {
    const extraKeys = keys.filter(k => k !== "if" && k !== "then" && k !== "label" && k !== "skip_label");
    if (extraKeys.length === 0) {
      return parseIfStep(obj);
    }
  }

  if (keys.length !== 1) {
    throw new Error(
      `Step must have exactly one primitive key (got ${keys.length}: ${keys.join(", ")})`,
    );
  }
  const key = keys[0];
  const body = obj[key];
  switch (key) {
    case "agent":
      return parseAgentStep(body);
    case "script":
      return parseScriptStep(body);
    case "foreach":
      return parseForeachStep(body);
    case "loop":
      return parseLoopStep(body);
    case "read-file":
      return parseReadFileStep(body);
    default:
      throw new Error(`Unknown step type: '${key}'`);
  }
}

function parseLoopStep(body: unknown): LoopStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'loop' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.max !== "number" || !Number.isInteger(obj.max) || obj.max < 1) {
    throw new Error("'loop.max' must be a positive integer");
  }
  if (typeof obj.until !== "string") {
    throw new Error("'loop.until' must be a string predicate");
  }
  if (!Array.isArray(obj.do)) {
    throw new Error("'loop.do' must be an array of steps");
  }
  const step: LoopStep = {
    type: "loop",
    max: obj.max,
    until: obj.until,
    do: obj.do.map(parseStep),
  };
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'loop.label' must be a string");
    step.label = obj.label;
  }
  return step;
}

function parseReadFileStep(body: unknown): ReadFileStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'read-file' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.path !== "string") {
    throw new Error("'read-file.path' must be a string");
  }
  if (typeof obj.set !== "string") {
    throw new Error("'read-file.set' must be a string (variable name)");
  }
  const step: ReadFileStep = {
    type: "read-file",
    path: obj.path,
    set: obj.set,
  };
  if (obj.trim !== undefined) {
    if (typeof obj.trim !== "boolean") {
      throw new Error("'read-file.trim' must be a boolean");
    }
    step.trim = obj.trim;
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'read-file.label' must be a string");
    step.label = obj.label;
  }
  return step;
}

function parseIfStep(obj: Record<string, unknown>): IfStep {
  const condition = obj.if;
  if (typeof condition !== "string") {
    throw new Error("'if' must be a string predicate");
  }
  const thenSteps = obj.then;
  if (!Array.isArray(thenSteps)) {
    throw new Error("'then' must be an array of steps");
  }
  const step: IfStep = {
    type: "if",
    condition,
    then: thenSteps.map(parseStep),
  };
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'if.label' must be a string");
    step.label = obj.label;
  }
  if (obj.skip_label !== undefined) {
    if (typeof obj.skip_label !== "string") throw new Error("'if.skip_label' must be a string");
    step.skip_label = obj.skip_label;
  }
  return step;
}

function parseForeachStep(body: unknown): ForeachStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'foreach' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  const varName = obj.var;
  if (typeof varName !== "string") {
    throw new Error("'foreach.var' must be a string");
  }
  const inExpr = obj.in;
  if (typeof inExpr !== "string") {
    throw new Error("'foreach.in' must be an expression string");
  }
  const doSteps = obj.do;
  if (!Array.isArray(doSteps)) {
    throw new Error("'foreach.do' must be an array of steps");
  }
  const step: ForeachStep = {
    type: "foreach",
    var: varName,
    in: inExpr,
    do: doSteps.map(parseStep),
  };
  if (obj.when !== undefined) {
    if (typeof obj.when !== "string") {
      throw new Error("'foreach.when' must be a string predicate");
    }
    step.when = obj.when;
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'foreach.label' must be a string");
    step.label = obj.label;
  }
  return step;
}

function parseScriptStep(body: unknown): ScriptStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'script' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  const name = obj.name;
  if (typeof name !== "string") {
    throw new Error("'script.name' must be a string");
  }
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "name" || k === "set" || k === "label") continue;
    args[k] = v == null ? "" : String(v);
  }
  const step: ScriptStep = { type: "script", name, args };
  if (obj.set !== undefined) {
    if (typeof obj.set !== "string") {
      throw new Error("'script.set' must be a string");
    }
    step.set = obj.set;
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'script.label' must be a string");
    step.label = obj.label;
  }
  return step;
}

function parseAgentStep(body: unknown): AgentStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'agent' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  const prompt = obj.prompt;
  if (typeof prompt !== "string") {
    throw new Error("'agent.prompt' must be a string (template name)");
  }
  const step: AgentStep = { type: "agent", prompt };
  if (obj.vars !== undefined) {
    if (typeof obj.vars !== "object" || obj.vars === null || Array.isArray(obj.vars)) {
      throw new Error("'agent.vars' must be an object");
    }
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.vars as Record<string, unknown>)) {
      vars[k] = v == null ? "" : String(v);
    }
    step.vars = vars;
  }
  if (obj.expect_file !== undefined) {
    if (typeof obj.expect_file !== "string") {
      throw new Error("'agent.expect_file' must be a string");
    }
    step.expect_file = obj.expect_file;
  }
  if (obj.label !== undefined) {
    if (typeof obj.label !== "string") throw new Error("'agent.label' must be a string");
    step.label = obj.label;
  }
  return step;
}

export interface FlowInfo {
  name: string;
  description?: string;
}

export async function listFlows(): Promise<FlowInfo[]> {
  const entries = await readdir(FLOWS_DIR);
  const results: FlowInfo[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".flow.yaml")) continue;
    const flow = await loadFlowFromFile(resolve(FLOWS_DIR, entry));
    results.push({ name: flow.name, description: flow.description });
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export async function flowExists(name: string): Promise<boolean> {
  const path = resolve(FLOWS_DIR, `${name}.flow.yaml`);
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
