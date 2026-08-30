# Document the Architecture of an Application

**Input**: The application to document is at the project root (`.`). The application name is `{app}`.

**Goal**: Analyze the application and write a comprehensive architecture document to `{docs_dir}/ARCHITECTURE.md`.

---

The document should contain the following sections:

- **Overall Architecture**: describes the overall architecture of the application.
- **Modules**: describes how the application is divided into modules, each module's role, and its dependencies.

## Goals of the Document

The purpose of the document is to let an AI agent or a human developer reason about the
system and know **where to go** for a programming task. It is the map, not the territory.

ARCHITECTURE.md is the only document that describes the whole system, so it is the one
document guaranteed to be read. That makes it the worst possible place to put detail:
everything written here is read by everyone and maintained by no one.

- Name each module, say in a sentence or two what it is for and what it depends on, and
  stop. The concept and feature documents own the detail.
- Describe modules by their public interface only. An internal implementation change
  must not require an edit here — only refactors and new features should.
- The document should be concise. Avoid flavour text and unnecessary sentences.

**Do not write any of the following.** Each one is a transcription that belongs to
another document, or to no document at all:

- Per-module export lists (`**Exports**: fn(), Type, CONSTANT, …`). Name the module's
  role; the reader opens the source or the feature document for its signatures.
- `> Internal implementation:` blocks describing non-exported helpers. A helper nobody
  outside the module can call is not part of the architecture.
- A walkthrough of the CLI. The CLI gets one paragraph naming its subcommands and what
  each is for. Flags, exit codes and error handling belong to the CLI feature document.
- Transcribed flag lists, constant values, and error-class inventories.
- Dependency lists longer than one line per module.

**Linking.** Where another document will own the detail, say so and link to it. When this
prompt runs during an `init` there are no other documents on disk yet — write the summary
without a link and stop there; a later verification pass adds the links once the plan
names the target documents. Never inline the detail as a substitute for a link.

## Length Budget

| Part | Budget |
| --- | --- |
| Overall Architecture | at most 60 lines, any diagram included |
| Modules | at most 8 lines per module |
| Whole document | at most 250 lines, frontmatter included |

If `60 + 8 x (number of modules)` exceeds 250, the module list is too granular. Group the
modules into subsystems and describe the subsystem — a reader who needs one module inside
it follows the link to that module's own document.

The budget counts every line in the file. Write to it while you write, not by trimming at
the end: a document that is over budget got there by documenting things that were never
this document's to document.

## Steps to Follow

1. Analyze the project and reason about how it's structured and how it's divided into modules or components.
2. Create a rubric with binary criteria for evaluating the quality of the final document. Include the Length Budget above as binary criteria — the per-module cap and the whole-document cap.
3. Based on the analysis, save a temporary file containing the structure of the app (this can be a file or directory listing) to `{scratch_path}`. The goal is to provide a persistent and reliable source for the structure and a checklist to make sure everything is covered.
4. Count the modules you will list and compute the budget: `60 + 8 x modules`, capped at 250. If the arithmetic exceeds 250, group modules into subsystems and count again.
5. Write the overall architecture section.
6. Write the module/component section. Before writing each entry, ask which document will own the detail — see Single Home per Fact below — and write only what this document owns.
7. Verify that the module/component section addresses the contents of the temporary file at `{scratch_path}`.
8. Count the document's lines. If it is over the budget from step 4, the fix is to delete what another document owns, not to compress prose.
9. Assess the quality of the final document using the rubric you defined in step 2. If the document does not score maximum points, address the flaws.

## Scope Exclusions

If a `.saagaignore` file exists at the project root, it lists paths and patterns (using gitignore syntax) that are excluded from documentation scope. Do not document any file or directory matching those patterns — omit them from the architecture overview and module descriptions entirely.

## Notes

- Write the document to `{docs_dir}/ARCHITECTURE.md`. Create the `{docs_dir}/` directory if it does not exist.
- Start the document with a YAML frontmatter block, before the `#` title line:

  ```markdown
  ---
  title: Architecture
  type: architecture
  sources:
    - {top-level source paths or globs this document describes}
  ---
  ```

  `sources` lists the paths you would re-read to check whether this document is
  still true — the top-level modules the architecture describes, not every file.
  Do not write a `last_verified` field; only verification sets that.
- If you create diagrams, draw them as mermaid charts with accessible colors.
- A high quality document is imperative. Write it with professional pride.
- Do NOT modify repository source code, configuration, or any files outside `{docs_dir}/` and `{scratch_path}`.
- Do NOT create git commits or run any git commands that modify the repository state.

---

{include:partials/single-home.md}

---

{include:partials/lod-policy.md}
