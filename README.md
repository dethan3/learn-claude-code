# Learn Agent Harness

This repository is becoming a collection of from-scratch agent harness courses.
Each course is kept in its own top-level folder so it can explain one product
line clearly without mixing its vocabulary, runtime assumptions, or teaching
path with the others.

## Courses

| Course | Focus | Start here |
| --- | --- | --- |
| [learn-claude-code](./learn-claude-code/) | Build the vehicle behind a coding agent: loop, tools, permissions, hooks, memory, tasks, teams, worktrees, and MCP. | [learn-claude-code/README.md](./learn-claude-code/README.md) |
| [learn-pi-agent](./learn-pi-agent/) | Build a minimal Pi-style coding-agent harness around a small kernel, explicit events, clear provider/runtime boundaries, and extension points. | [learn-pi-agent/README.md](./learn-pi-agent/README.md) |

## Repository Layout

```text
.
├── learn-claude-code/   # Existing Claude Code harness course
├── learn-pi-agent/      # Pi harness MVP course
├── .github/             # Repository-level CI
├── .gitignore           # Shared ignore rules for local state and build output
└── README.md            # Course collection entry
```

## Local Files

Do not commit local runtime state or credentials. The root `.gitignore` excludes
common local files such as `.claude/`, `.env`, `.DS_Store`, `node_modules/`,
build output, logs, temporary files, local databases, and packaged exports.

Course-specific install and run commands live inside each course folder.
