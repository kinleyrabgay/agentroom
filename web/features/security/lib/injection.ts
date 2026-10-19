import { INJECTION_MARKER } from "../constants"

/** True when the server marked a tool's output as possible prompt injection. */
export const hasInjectionFlag = (output: string | undefined) => !!output && output.includes(INJECTION_MARKER)
