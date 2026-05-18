# Shared Memory MCP Instructions

You have access to a `shared-memory` MCP server for local multi-agent context sharing.

Use these tools when relevant:

- `save_context`: save durable context for later.
- `save_memory`: save structured notes, decisions, tasks, risks, assumptions, and snapshots.
- `create_handoff`: create a handoff for another agent.
- `read_handoff`: read this agent's next pending handoff.
- `peek_handoff`: inspect a handoff without marking it read.
- `list_handoffs`: review handoffs by destination and status.
- `read_latest_context`: read the latest saved context.
- `list_contexts`: list recent saved context and handoffs.
- `search_memory`: search memory by text and metadata.
- `get_project_brief`: load the latest namespace summary.

Use a stable agent name when writing or reading memory. Examples:

- `agent-a`
- `agent-b`
- `planner`
- `implementer`
- `reviewer`

Use a stable namespace for each project or repository. Before starting work, load the project brief and search recent memory for decisions, risks, and pending handoffs. Before ending work, save important decisions and create a handoff when another agent should continue.
