import { toast } from "sonner"
import { mcpApi } from "@/lib/api/endpoints"

/** Start a browser sign-in; Claude Code finishes it on its localhost callback and the status updates by itself. */
export async function signIn(name: string) {
  try {
    const res = await mcpApi.signIn(name)
    if (res.connected) {
      toast.success(`${name} is connected`)
      return
    }
    window.open(res.url, "_blank", "noopener,noreferrer")
    toast.message(res.external ? "Connect it on claude.ai" : `Finish signing in to ${name} in the new tab`, {
      description: res.external
        ? "claude.ai connectors are signed in on claude.ai. Come back and press Refresh."
        : "AgentRoom picks it up as soon as you're done.",
    })
  } catch (e) {
    toast.error((e as Error).message)
  }
}
