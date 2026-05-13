# shared-memory-mcp

Local MCP server for shared memory and handoff between multiple agents.

The server stores small pieces of local context in a JSON file and exposes MCP tools that any connected agent can call. It is meant for workflows where more than one assistant, coding agent, or MCP-compatible client needs to pass work state forward without relying on a remote service.

## Features

- Save reusable context with agent name, title, content, and tags.
- Create structured handoffs for another agent.
- Read the next pending handoff for the current agent and mark it as read.
- List recent contexts and handoffs.
- Local-only JSON storage.
- Atomic writes, process lock, stale-lock recovery, and pending-handoff-aware retention.
- Install helpers for Claude Code and Codex.

## Tools

| Tool | Purpose |
| --- | --- |
| `save_context` | Save free-form context for later use. |
| `create_handoff` | Create a structured handoff for another agent. |
| `read_handoff` | Read a pending handoff for this agent and mark it as read. |
| `read_latest_context` | Read the most recent saved context, optionally filtered by agent. |
| `list_contexts` | List recent contexts and handoffs. |

Tool names and input fields are English so the server can be used across projects, clients, and agent teams.

## Install From This Repository

```bash
npm install
npm test
npm run smoke
```

Run the MCP server:

```bash
npm start
```

## Configure Clients

Configure Claude Code:

```bash
npm run install:claude
```

Configure Codex:

```bash
npm run install:codex
```

Configure both:

```bash
npm run install:local
```

The installers are idempotent. They update the relevant MCP server entry without duplicating it.

Create or update a local `.env` file:

```bash
npm run setup:env
```

## Storage

Default storage file:

```text
~/.shared-memory-mcp/contexts.json
```

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `SHARED_MEMORY_MCP_STORAGE_FILE` | `~/.shared-memory-mcp/contexts.json` | Absolute or relative JSON storage path. |
| `SHARED_MEMORY_MCP_MAX_ITEMS` | `50` | Maximum retained items. Pending handoffs are kept first. |
| `SHARED_MEMORY_MCP_READ_HANDOFF_TTL_DAYS` | `7` | Days to keep read handoffs before auto-clean removes them. |
| `SHARED_MEMORY_MCP_DELETE_READ_HANDOFFS` | `false` | Delete a handoff immediately after it is read. |

## Input Safety And Cleanup

Inputs are sanitized before storage:

- required strings are trimmed
- dangerous control characters are removed
- empty required values are rejected
- fields have conservative size limits
- tags are trimmed, deduplicated, and capped

Read handoffs receive a `readAt` timestamp. Cleanup runs automatically during storage operations. Pending handoffs are retained before ordinary contexts when the max item limit is reached.

## Agent Instructions

This package does not assume a specific project or organization. Copy and adapt the examples in:

- `examples/claude/CLAUDE.md`
- `examples/codex/AGENTS.md`
- `examples/generic/agent-instructions.md`

Use stable agent names in handoffs. For example:

- `claude-code`
- `codex`
- `review-agent`
- `docs-agent`

## Publishing Checklist

Before publishing:

```bash
npm run check
npm test
npm run smoke
npm pack --dry-run
```

Then add repository metadata to `package.json` once the GitHub repository URL exists.
