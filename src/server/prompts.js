import { z } from "zod"

function promptMessage(text) {
  return {
    messages: [{
      role: "user",
      content: { type: "text", text }
    }]
  }
}

export function registerPrompts(server) {
  server.registerPrompt(
    "prepare_handoff",
    {
      title: "Prepare Handoff",
      description: "Draft a complete handoff for another agent.",
      argsSchema: {
        to: z.string().describe("Destination agent name"),
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ to, namespace }) => promptMessage(
      `Prepare a concise but complete handoff for ${to}${namespace ? ` in namespace ${namespace}` : ""}. Include summary, current state, files or decisions that matter, risks, and the exact next action.`
    )
  )

  server.registerPrompt(
    "load_project_memory",
    {
      title: "Load Project Memory",
      description: "Load the relevant shared memory before starting work.",
      argsSchema: {
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ namespace }) => promptMessage(
      `Load shared memory${namespace ? ` for namespace ${namespace}` : ""}. Read the project brief, recent memory, and pending handoffs before making changes.`
    )
  )

  server.registerPrompt(
    "summarize_decisions",
    {
      title: "Summarize Decisions",
      description: "Summarize saved decisions in shared memory.",
      argsSchema: {
        namespace: z.string().optional().describe("Project namespace")
      }
    },
    async ({ namespace }) => promptMessage(
      `Summarize the important decisions${namespace ? ` in namespace ${namespace}` : ""}. Group them by topic, include the rationale, and identify any stale or conflicting decisions.`
    )
  )
}
