import { ToolName } from "@shared"

/** Tools offered in the bot config, with a short hint each. */
export const CONFIGURABLE_TOOLS: { id: ToolName; hint: string }[] = [
  { id: ToolName.Read, hint: "read files" },
  { id: ToolName.Grep, hint: "search code" },
  { id: ToolName.Glob, hint: "find files" },
  { id: ToolName.Edit, hint: "change files" },
  { id: ToolName.Write, hint: "create files" },
  { id: ToolName.Bash, hint: "run commands" },
  { id: ToolName.Browser, hint: "in-app browser" },
  { id: ToolName.WebSearch, hint: "search the web" },
  { id: ToolName.WebFetch, hint: "fetch URLs" },
]

export const NO_MANAGER = "__none__"
