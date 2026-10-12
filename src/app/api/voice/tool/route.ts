import { toolRequest } from "@/lib/voice/requests";
import { handleVoice } from "@/lib/voice/respond";
import { runVoiceTool } from "@/lib/voice/voice";

// POST /api/voice/tool { businessSlug, sessionId, name, arguments } -> { output, sources, action }
// Runs a tool the voice model called; the browser sends `output` back to it.
export function POST(request: Request) {
  return handleVoice(request, toolRequest, "tool", async (input) => Response.json(await runVoiceTool(input)));
}
