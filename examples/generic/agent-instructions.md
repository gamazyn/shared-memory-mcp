# Shared Memory MCP Instructions

You have access to a `shared-memory` MCP server for local multi-agent context sharing.

Use these tools when relevant:

- `save_context`: save durable context for later.
- `create_handoff`: create a handoff for another agent.
- `read_handoff`: read this agent's next pending handoff.
- `read_latest_context`: read the latest saved context.
- `list_contexts`: list recent saved context and handoffs.

Use a stable agent name when writing or reading memory. Examples:

- `agent-a`
- `agent-b`
- `planner`
- `implementer`
- `reviewer`
