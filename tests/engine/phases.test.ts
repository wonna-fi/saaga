import { describe, expect, test } from "vitest";
import { PhaseTracker } from "../../src/engine/phases.js";
import type { FlowDefinition, IfStep, Scope } from "../../src/engine/types.js";

describe("PhaseTracker", () => {
  test("counts agent and script steps", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        { type: "script", name: "b", args: {} },
        { type: "agent", prompt: "c" },
      ],
    };
    const tracker = new PhaseTracker(flow);
    const scope: Scope = {};

    expect(tracker.total(scope)).toBe(3);
  });

  test("read-file counts as 0 units", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        { type: "read-file", path: "/x", set: "v" },
        { type: "agent", prompt: "b" },
      ],
    };
    const tracker = new PhaseTracker(flow);
    expect(tracker.total({})).toBe(2);
  });

  // A top-level loop is one phase however many times it goes round: its body
  // reports under that number with an iteration suffix, so a retry does not
  // make the total jump. Counting its body instead would make M depend on how
  // many iterations happen to be needed, which is not known in advance.
  test("a top-level loop counts as 1 unit regardless of its body", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        {
          type: "loop",
          max: 3,
          until: "done",
          do: [
            { type: "agent", prompt: "inner" },
            { type: "read-file", path: "/x", set: "v" },
            { type: "agent", prompt: "alsoInner" },
          ],
        },
        { type: "agent", prompt: "b" },
      ],
    };
    const tracker = new PhaseTracker(flow);
    expect(tracker.total({})).toBe(3);
  });

  // Inside a foreach the counter never recurses into the body at all, so a
  // loop nested there contributes nothing and the item's own phase covers it.
  test("a loop inside a foreach body does not add to the total", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        {
          type: "foreach",
          var: "p",
          in: "${phases}",
          do: [
            { type: "agent", prompt: "slice" },
            { type: "loop", max: 3, until: "done", do: [{ type: "agent", prompt: "verify" }] },
          ],
        },
      ],
    };
    const tracker = new PhaseTracker(flow);
    expect(tracker.total({ phases: [1, 2] })).toBe(2);
  });

  test("foreach counts items from scope", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        {
          type: "foreach",
          var: "item",
          in: "${items}",
          do: [{ type: "agent", prompt: "inner" }],
        },
      ],
    };
    const tracker = new PhaseTracker(flow);

    expect(tracker.total({})).toBeNull();
    expect(tracker.total({ items: [1, 2, 3] })).toBe(4); // 1 agent + 3 foreach items
  });

  test("foreach with when filter reduces count", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        {
          type: "foreach",
          var: "phase",
          in: "${phases}",
          when: '${phase.number} != 0',
          do: [{ type: "agent", prompt: "slice" }],
        },
      ],
    };
    const tracker = new PhaseTracker(flow);
    const phases = [
      { number: 0, title: "Overview" },
      { number: 1, title: "Core" },
      { number: 2, title: "API" },
    ];

    expect(tracker.total({ phases })).toBe(2);
  });

  test("if-step counts body when taken, 1 when skipped", () => {
    const ifStep: IfStep = {
      type: "if",
      condition: '${changes.count} != 0',
      then: [
        { type: "agent", prompt: "a" },
        { type: "script", name: "b", args: {} },
      ],
    };
    const flow: FlowDefinition = {
      name: "test",
      steps: [ifStep],
    };
    const tracker = new PhaseTracker(flow);

    tracker.recordIfOutcome(ifStep, true);
    expect(tracker.total({ changes: { count: 5 } })).toBe(2);

    const tracker2 = new PhaseTracker(flow);
    tracker2.recordIfOutcome(ifStep, false);
    expect(tracker2.total({ changes: { count: 0 } })).toBe(1);
  });

  test("advance increments the counter", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        { type: "agent", prompt: "b" },
      ],
    };
    const tracker = new PhaseTracker(flow);

    expect(tracker.advance()).toBe(1);
    expect(tracker.advance()).toBe(2);
  });

  test("formatCounter shows N/M or N/?", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "agent", prompt: "a" },
        { type: "foreach", var: "x", in: "${items}", do: [{ type: "agent", prompt: "b" }] },
      ],
    };
    const tracker = new PhaseTracker(flow);
    tracker.advance();

    expect(tracker.formatCounter({})).toBe("Phase 1/?");
    expect(tracker.formatCounter({ items: [1, 2] })).toBe("Phase 1/3");
  });

  test("total resolves once foreach source becomes available", () => {
    const flow: FlowDefinition = {
      name: "test",
      steps: [
        { type: "script", name: "parse-plan", args: {}, set: "phases" },
        { type: "foreach", var: "p", in: "${phases}", do: [{ type: "agent", prompt: "s" }] },
        { type: "script", name: "generate-baseline", args: {} },
      ],
    };
    const tracker = new PhaseTracker(flow);
    const scope: Scope = {};

    expect(tracker.total(scope)).toBeNull();

    scope.phases = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(tracker.total(scope)).toBe(5); // 1 + 3 + 1
  });
});
