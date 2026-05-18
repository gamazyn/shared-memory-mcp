## Shared Memory — Multi-Agent Handoff

An MCP server named `shared-memory` is available. Use it automatically in these situations:

**When the user asks to pass work to another agent**
Call `create_handoff` with:
- `to`: the destination agent name
- `summary`: what was done and what should continue
- `context`: all details needed to continue safely

**When the user asks what another agent handed off**
Call `get_project_brief`, then `read_handoff` with this agent's stable name.

**When the user asks to save context**
Call `save_memory` for decisions, tasks, risks, assumptions, and snapshots. Use `save_context` only for plain notes.

**When the user asks what has been saved**
Call `search_memory` or `list_contexts`.

Use the same `namespace` for all memory related to the same repository or project.
