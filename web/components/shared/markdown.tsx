"use client"

import { memo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-[15px] font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-medium first:mt-0">{children}</h4>,
  // GitHub task lists ("- [x] done") render as checkboxes without bullets.
  ul: ({ className, children }) => (
    <ul className={cn("my-2 space-y-1 marker:text-muted-foreground", className?.includes("contains-task-list") ? "list-none pl-0.5" : "list-disc pl-5")}>
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ className, children }) => (
    <li className={cn("leading-relaxed", className?.includes("task-list-item") ? "flex items-start gap-2" : "pl-0.5")}>{children}</li>
  ),
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <span
        role="checkbox"
        aria-checked={!!checked}
        aria-disabled
        className={cn(
          "mt-[0.3em] grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    ) : null,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-ink underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-4" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-sunken">{children}</thead>,
  th: ({ children }) => <th className="border-b px-3 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-1.5 align-top last:border-b-0">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border bg-sunken p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code className={cn("rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-[0.85em]", className)}>{children}</code>
  ),
}

/** Safe markdown (GFM; raw HTML is not rendered). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
})
