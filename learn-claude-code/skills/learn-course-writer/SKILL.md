---
name: learn-course-writer
description: Use when designing, writing, reviewing, or packaging learn-XX repositories, source-grounded programming courses, runnable lesson series, or web-published technical curricula.
---

# Learn Course Writer

## Overview

This skill turns a real codebase into a `learn-XX` course: a cumulative, runnable, source-grounded lesson series with an optional generated web publishing layer.

Core principle: **teach the system's design spine, not its file tree.** Source code is the source of truth, but the course mainline should be a small implementation that grows chapter by chapter.

## When to Use

Use this for:

- Creating a new `learn-XX` repository from a target source project
- Rewriting lesson READMEs or code so they feel like a coherent course
- Auditing whether a course has become a source-code tour instead of a 0-to-1 tutorial
- Adding generated web pages for lessons, code, diagrams, diffs, simulations, or deep dives
- Packaging a course into a public artifact with strict file contracts

Do not use this for ordinary API docs, one-off blog posts, or full production reimplementations.

## Source Of Truth

Before writing chapters, identify the target project's real design spine:

1. Read the project README, architecture docs, and public API examples.
2. Find the smallest runtime loop or lifecycle that makes the project real.
3. Trace core state objects, tool/capability boundaries, extension points, persistence, and error paths.
4. Separate production complexity from teachable invariants.
5. Decide the course mainline from the design spine, not from directory order.

Never copy chapter order from another course unless it matches the target project's own design.

## Course Shape

A strong `learn-XX` course uses one cumulative track:

```text
s01_minimal_core/
s02_next_mechanism/
s03_next_boundary/
...
sNN_complete_system/
```

Each chapter adds one mechanism. Earlier code should remain understandable and runnable. The last chapter recombines the mechanisms into a complete mini system.

Good chapter progression usually follows this pattern:

| Stage | Purpose |
|---|---|
| Minimal loop | Show the smallest thing that works |
| Capability surface | Add tools, providers, handlers, or plugins |
| State and events | Make execution inspectable |
| Boundaries | Add permissions, trust, validation, or isolation |
| Context and persistence | Add memory, session, history, or compaction |
| Extension/runtime | Add hooks, skills, MCP, schedulers, teams, or deployment |
| Comprehensive chapter | Put the pieces back into one system |

## Chapter Contract

Each lesson directory should contain:

- `README.md`: the primary lesson
- `code.*`: a runnable single-file or minimal local implementation
- `images/`: optional diagrams and screenshots
- Optional translations such as `README.en.md` or `README.ja.md`

If the final deliverable has a strict packaging contract, keep tests, demos, source notes, and scratch files out of the final package unless explicitly requested.

## README Pattern

Use this structure for each chapter:

1. Title: `sXX: Concept -- plain-language promise`
2. Language links and chapter navigation
3. Motto: one memorable design sentence
4. Harness/design layer: what layer this chapter teaches
5. `## 问题`: a concrete failure or friction the reader recognizes
6. `## 解决方案`: the new mechanism and a diagram if useful
7. `## 工作原理`: step-by-step code walkthrough
8. `## 相对 sXX 的变更`: table of exact deltas
9. `## 试一下`: commands, prompts, and what to observe
10. `## 接下来`: why the next mechanism is needed
11. `<details>` deep dive: source mapping, production differences, simplifications

Keep the prose natural. Avoid AI-sounding filler, over-literal metaphors, and unexplained terms. A term should not appear before the chapter has introduced it.

## Code Pattern

Lesson code should be boring on purpose:

- Prefer one runnable file per chapter.
- Keep dependencies minimal and visible.
- Mark inherited code with comments like `FROM sXX`.
- Mark new code with comments like `NEW in sXX`.
- Preserve the previous chapter's core loop when the lesson is about adding a surrounding mechanism.
- Use simple names that match the README vocabulary.
- Add safety checks where the demo can touch files, shell, network, or credentials.

The code may simplify production behavior, but it must not break the target system's important invariants.

## Source Mapping

Every chapter should answer:

- What production concept does this chapter approximate?
- Which source files or APIs prove that concept exists?
- What did the teaching version intentionally omit?
- Which invariant is preserved despite simplification?

Good deep dives compare teaching and production behavior in a table. State omissions directly: "teaching version uses mock transport; production uses stdio/http/ws and OAuth".

## Web Publishing Layer

If the course needs a web page, generate it from the lesson directories instead of hand-writing course content in the web app.

Recommended pipeline:

```text
sXX lesson dirs
  -> extract script
  -> generated docs/code metadata/assets
  -> web pages
```

The extractor should:

- Discover `sXX_*` directories in order.
- Read each chapter README for every locale.
- Read `code.*` for source viewing and metadata.
- Copy `images/` into public course assets.
- Rewrite Markdown image paths and chapter links.
- Extract function/class/tool lists when useful.
- Produce generated JSON or TypeScript data consumed by the web app.

Recommended web tabs:

| Tab | Contents |
|---|---|
| Learn | Rendered lesson README |
| Simulate | Optional scenario playback for this chapter |
| Code | Source viewer for `code.*` |
| Deep Dive | Execution flow, architecture, diffs, design decisions |

The web app is a publishing layer. The lesson directories remain the source of truth.

## Verification

Before calling a course complete:

- Run every chapter's code with the documented command.
- Run type checks or syntax checks for all lesson files.
- Test the invariants most likely to drift across chapters.
- Build the web app after extraction if a web layer exists.
- Check that generated pages render images, code, and links.
- Compare README claims against current source, not memory or old drafts.

For course tests, focus on invariants rather than exhaustive coverage: message/tool-result pairing, path safety, schema parsing, permission boundaries, serialization, and chapter-to-chapter compatibility.

## Common Failures

| Failure | Fix |
|---|---|
| Course becomes a source tour | Rebuild a cumulative mini implementation; move source-map detail into deep dives |
| Chapters are parallel demos | Add an evolution table and make each chapter connect back to the mainline |
| Reference course dominates | Borrow pedagogy, not domain framing or chapter names |
| README and code drift | Verify code first, then rewrite prose around current symbols |
| New terms appear too early | Add vocabulary boundaries per chapter |
| Web content is duplicated | Generate web data from lesson directories |
| Tests/demos leak into package | Separate development scaffold from final deliverable |

## Pressure Scenarios

Use these to test the skill before relying on it globally:

1. "Make a `learn-pi-agent` course like `learn-claude-code`." The agent should extract Pi's own spine, not copy Claude Code's chapter order.
2. "Write all 12 chapters quickly from memory." The agent should refuse memory-only writing and inspect source first.
3. "Add a web page for the course." The agent should generate from lesson dirs, not duplicate Markdown by hand.
4. "Package the course." The agent should obey the final file contract and exclude scratch tests or source notes unless requested.
