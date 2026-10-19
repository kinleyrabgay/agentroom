import { HostTool, ToolName } from "@shared"
import { HOST_TOOL_PREFIX } from "@/lib/constants"

const BROWSER_PREFIX = `${HOST_TOOL_PREFIX}browser_`

export interface ToolRequestView {
  isBrowser: boolean
  /** Short label for the tool chip. */
  label: string
  /** The "Always allow …" group (matches the server's permission groups). */
  group: string
  /** Text preview of what will happen. */
  preview: string
}

/** How to present a permission request for a tool call. */
export function describeRequest(tool: string, input: Record<string, unknown>, summary: string): ToolRequestView {
  const isBrowser = tool.startsWith(BROWSER_PREFIX)
  const isEval = tool === HOST_TOOL_PREFIX + HostTool.BrowserEval
  const label = isBrowser ? tool.replace(BROWSER_PREFIX, "browser · ") : tool
  const group = isEval ? "Browser JS" : isBrowser ? "Browser" : tool

  let preview: string
  if (tool === ToolName.Bash) preview = `$ ${String(input.command)}`
  else if (isEval) preview = String(input.code)
  else if (isBrowser) {
    preview = `${String(input.element ?? input.ref ?? summary ?? "")}${input.text ? `  ←  "${String(input.text)}"` : ""}${input.key ? `  key: ${String(input.key)}` : ""}`
  } else preview = JSON.stringify(input, null, 2)

  return { isBrowser, label, group, preview }
}
