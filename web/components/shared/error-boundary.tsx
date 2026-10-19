"use client"

import { Component, useState, type ErrorInfo, type ReactNode } from "react"
import { CheckIcon, ChevronRightIcon, CopyIcon, RefreshCwIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface Props {
  /** Shown in the fallback, e.g. "Tasks". */
  label?: string
  /** Render the fallback as a slim inline row (sidebar) instead of a full error screen. */
  compact?: boolean
  className?: string
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string
}

/**
 * Contains a crash to one section so a bug in one feature never takes down the whole app.
 * Full sections get a proper error screen with the message, details to copy, Retry and Reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" })
    console.error(`[AgentRoom] ${this.props.label ?? "Section"} crashed:`, error, info.componentStack)
  }

  private retry = () => this.setState({ error: null, componentStack: "" })

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    const { label, compact, className } = this.props

    if (compact) {
      return (
        <div role="alert" className={cn("flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground", className)}>
          <TriangleAlertIcon className="tone-warning tone-text size-3.5 shrink-0" />
          <span className="min-w-0 truncate" title={error.message}>
            {label ? `${label} failed to load` : "Failed to load"}
          </span>
          <button onClick={this.retry} className="ml-auto inline-flex items-center gap-1 rounded font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
            <RotateCwIcon className="size-3" /> Retry
          </button>
        </div>
      )
    }

    return <ErrorScreen label={label} error={error} componentStack={componentStack} onRetry={this.retry} className={className} />
  }
}

function ErrorScreen({
  label,
  error,
  componentStack,
  onRetry,
  className,
}: {
  label?: string
  error: Error
  componentStack: string
  onRetry: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const details = [
    `${label ?? "Section"} crashed: ${error.name}: ${error.message}`,
    `Page: ${typeof location !== "undefined" ? location.pathname : ""}`,
    `Time: ${new Date().toISOString()}`,
    "",
    error.stack ?? "",
    componentStack ? `\nComponent stack:${componentStack}` : "",
  ].join("\n")

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setOpen(true)
    }
  }

  return (
    <div role="alert" className={cn("grid h-full place-items-center overflow-y-auto p-6", className)}>
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-xs">
        <div className="flex items-start gap-3">
          <span className="tone-warning tone-soft grid size-10 shrink-0 place-items-center rounded-xl border">
            <TriangleAlertIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{label ? `${label} couldn't load` : "This section couldn't load"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Something went wrong while showing this page. The rest of AgentRoom keeps working.
            </p>
          </div>
        </div>

        <p className="mt-4 rounded-lg border bg-sunken px-3 py-2 font-mono text-xs break-words">{error.message || error.name}</p>

        <p className="mt-3 text-xs text-muted-foreground">
          Just updated AgentRoom? Restart <code className="font-mono">agentroom start</code> so the server and the page match, then reload.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onRetry}>
            <RotateCwIcon data-icon="inline-start" /> Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => location.reload()}>
            <RefreshCwIcon data-icon="inline-start" /> Reload page
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={copy}>
            {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>

        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-4 flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} /> Technical details
        </button>
        {open && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg border bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {details}
          </pre>
        )}
      </div>
    </div>
  )
}
