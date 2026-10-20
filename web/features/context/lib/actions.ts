import { toast } from "sonner"
import { contextApi } from "@/lib/api/endpoints"
import { setContext } from "./context-store"

/** Start a sync on the server; progress arrives over the live channel. */
export function startSync(input: { full?: boolean; cards?: boolean; only?: string[] } = {}) {
  contextApi
    .sync(input)
    .then((status) => setContext({ status }))
    .catch((e) => toast.error((e as Error).message))
}
