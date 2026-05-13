## Shared Memory — Multi-Agent Handoff

An MCP server named `shared-memory` is available. Use it automatically in these situations:

**When the user says to continue from another agent**
Call `read_handoff` with this agent's stable name.

**When the user asks to pass work to another agent**
Call `create_handoff` with:
- `to`: the destination agent name
- `summary`: what was done and what should continue
- `context`: all details needed to continue safely

**When the user asks to save context**
Call `save_context` with this agent's stable name and a descriptive title.

**When the user asks what has been saved**
Call `list_contexts`.
