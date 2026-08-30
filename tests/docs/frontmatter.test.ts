import { describe, expect, test } from "vitest";
import {
  type DocFrontmatter,
  parseDoc,
  serializeDoc,
} from "../../src/docs/frontmatter.js";

const CONCEPT_DOC = `---
title: Scope and Expressions
type: concept
sources:
  - src/engine/expression.ts
---

# Scope and Expressions

Body text.
`;

describe("parseDoc", () => {
  test("parses a full frontmatter block and strips it from the body", () => {
    const { frontmatter, body, errors } = parseDoc(CONCEPT_DOC);

    expect(errors).toEqual([]);
    expect(frontmatter).toEqual({
      title: "Scope and Expressions",
      type: "concept",
      sources: ["src/engine/expression.ts"],
    });
    expect(body).toBe("\n# Scope and Expressions\n\nBody text.\n");
  });

  test("parses last_verified when present", () => {
    const doc = `---
title: Init Workflow
type: feature
last_verified: 2026-08-29
---

# Init Workflow
`;
    const { frontmatter, errors } = parseDoc(doc);

    expect(errors).toEqual([]);
    expect(frontmatter?.last_verified).toBe("2026-08-29");
  });

  test.each([
    "concept",
    "pattern",
    "convention",
    "feature",
    "architecture",
    "index",
  ])(
    "accepts type %s",
    (type) => {
      const { frontmatter, errors } = parseDoc(
        `---\ntitle: T\ntype: ${type}\n---\n\n# T\n`,
      );
      expect(errors).toEqual([]);
      expect(frontmatter?.type).toBe(type);
    },
  );

  test("treats a document without frontmatter as valid and untouched", () => {
    const doc = "# Legacy Document\n\nWritten before the format existed.\n";
    const { frontmatter, body, errors } = parseDoc(doc);

    expect(frontmatter).toBeNull();
    expect(body).toBe(doc);
    expect(errors).toEqual([]);
  });

  test("does not treat a mid-document horizontal rule as frontmatter", () => {
    const doc = "# Title\n\n---\n\nA section after a rule.\n";
    const { frontmatter, body } = parseDoc(doc);

    expect(frontmatter).toBeNull();
    expect(body).toBe(doc);
  });

  test("reports malformed YAML instead of throwing", () => {
    const doc = "---\ntitle: [unclosed\n---\n\n# T\n";

    expect(() => parseDoc(doc)).not.toThrow();
    const { frontmatter, errors } = parseDoc(doc);
    expect(frontmatter).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/invalid YAML/);
  });

  test("reports an unknown type", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: glossary\n---\n\n# T\n",
    );

    expect(frontmatter).toBeNull();
    expect(errors).toEqual([
      { field: "type", message: expect.stringContaining("must be one of") },
    ]);
  });

  test("reports a missing title and a missing type", () => {
    const { frontmatter, errors } = parseDoc("---\nsources: []\n---\n\n# T\n");

    expect(frontmatter).toBeNull();
    expect(errors.map((e) => e.field).sort()).toEqual(["title", "type"]);
  });

  test("reports a non-string title", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: 42\ntype: concept\n---\n\n# T\n",
    );

    expect(frontmatter).toBeNull();
    expect(errors).toEqual([
      { field: "title", message: expect.stringContaining("non-empty string") },
    ]);
  });

  test("reports a non-ISO last_verified but keeps the usable fields", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: concept\nlast_verified: yesterday\n---\n\n# T\n",
    );

    expect(errors).toEqual([
      {
        field: "last_verified",
        message: expect.stringContaining("ISO date"),
      },
    ]);
    expect(frontmatter).toEqual({ title: "T", type: "concept" });
  });

  test("reports non-list sources but keeps the usable fields", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: concept\nsources: src/foo.ts\n---\n\n# T\n",
    );

    expect(errors).toEqual([
      { field: "sources", message: expect.stringContaining("list of strings") },
    ]);
    expect(frontmatter).toEqual({ title: "T", type: "concept" });
  });

  test("parses terms when present", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: concept\nterms:\n  - phase\n  - slice\n---\n\n# T\n",
    );

    expect(errors).toEqual([]);
    expect(frontmatter).toEqual({ title: "T", type: "concept", terms: ["phase", "slice"] });
  });

  test("reports non-list terms but keeps the usable fields", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: concept\nterms: phase\n---\n\n# T\n",
    );

    expect(errors).toEqual([
      { field: "terms", message: expect.stringContaining("list of strings") },
    ]);
    expect(frontmatter).toEqual({ title: "T", type: "concept" });
  });

  test("reports a terms list containing a non-string", () => {
    const { frontmatter, errors } = parseDoc(
      "---\ntitle: T\ntype: concept\nterms:\n  - phase\n  - 7\n---\n\n# T\n",
    );

    expect(errors).toEqual([
      { field: "terms", message: expect.stringContaining("list of strings") },
    ]);
    expect(frontmatter).toEqual({ title: "T", type: "concept" });
  });

  test("reports an empty frontmatter block", () => {
    const { frontmatter, errors } = parseDoc("---\n\n---\n\n# T\n");

    expect(frontmatter).toBeNull();
    expect(errors).toHaveLength(1);
  });

  test("reports a non-mapping frontmatter block", () => {
    const { frontmatter, errors } = parseDoc("---\n- a\n- b\n---\n\n# T\n");

    expect(frontmatter).toBeNull();
    expect(errors).toEqual([
      { message: expect.stringContaining("YAML mapping") },
    ]);
  });
});

describe("serializeDoc", () => {
  test("round-trips a parsed document", () => {
    const parsed = parseDoc(CONCEPT_DOC);
    const round = serializeDoc(parsed.frontmatter!, parsed.body);

    expect(round).toBe(CONCEPT_DOC);
    expect(parseDoc(round).frontmatter).toEqual(parsed.frontmatter);
  });

  test("round-trips every doc type, with and without optional fields", () => {
    const cases: DocFrontmatter[] = [
      { title: "A Concept", type: "concept", sources: ["src/a.ts"] },
      { title: "A Pattern", type: "pattern" },
      {
        title: "Feature: B",
        type: "feature",
        last_verified: "2026-01-02",
        sources: ["src/b/*.ts", "src/c.ts"],
      },
      { title: "Architecture", type: "architecture", sources: ["src/"] },
      { title: "Concepts Index", type: "index" },
      { title: "Plan Parsing", type: "feature", terms: ["phase", "slice"] },
    ];

    for (const frontmatter of cases) {
      const doc = serializeDoc(frontmatter, "\n# Heading\n");
      const parsed = parseDoc(doc);
      expect(parsed.errors).toEqual([]);
      expect(parsed.frontmatter).toEqual(frontmatter);
      expect(parsed.body).toBe("\n# Heading\n");
    }
  });

  test("omits optional fields that are not set", () => {
    const doc = serializeDoc({ title: "T", type: "index" }, "\n# T\n");

    expect(doc).not.toContain("last_verified");
    expect(doc).not.toContain("sources");
    expect(doc).not.toContain("terms");
  });

  test("emits fields in schema order", () => {
    const doc = serializeDoc(
      {
        title: "T",
        type: "concept",
        last_verified: "2026-01-02",
        sources: ["src/a.ts"],
        terms: ["phase"],
      },
      "\n# T\n",
    );

    const fieldOrder = doc
      .split("\n")
      .filter((l) => /^[a-z_]+:/.test(l))
      .map((l) => l.split(":")[0]);
    // `terms` is appended last on purpose: inserting it earlier would change
    // the bytes of every already-generated document on its next round trip.
    expect(fieldOrder).toEqual(["title", "type", "last_verified", "sources", "terms"]);
  });
});
