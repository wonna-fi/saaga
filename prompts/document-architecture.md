# Document the Architecture of an Application

**Input**: The application to document is at the project root (`.`). The application name is `{app}`.

**Goal**: Analyze the application and write a comprehensive architecture document to `{docs_dir}/ARCHITECTURE.md`.

---

The document should contain the following sections:

- **Overall Architecture**: describes the overall architecture of the application.
- **Modules**: describes how the application is divided into modules, each module's role, and its dependencies.

## Goals of the Document

The purpose of the document is to give an AI agent or a human developer as much information as possible to reason about the system and know where to approach a programming task.

The document will need to be maintained and updated, so it should follow these guidelines:

- Modules should be described in terms of their public interface and properties.
- Internal implementation changes to modules should not require updates to this document.
- Only refactors and new features should require updating this document.

The document should be concise. Avoid flavour text and unnecessary sentences.

## Steps to Follow

1. Analyze the project and reason about how it's structured and how it's divided into modules or components.
2. Create a rubric with binary criteria for evaluating the quality of the final document.
3. Based on the analysis, save a temporary file containing the structure of the app (this can be a file or directory listing) to `{scratch_path}`. The goal is to provide a persistent and reliable source for the structure and a checklist to make sure everything is covered.
4. Write the overall architecture section.
5. Write the module/component section.
6. Verify that the module/component section addresses the contents of the temporary file at `{scratch_path}`.
7. Assess the quality of the final document using the rubric you defined in step 2. If the document does not score maximum points, address the flaws.

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
