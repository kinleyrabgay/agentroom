export function Diff({ before, after, path }: { before: string; after: string; path?: string }) {
  const lines = (s: string) => (s ? s.split("\n") : [])
  return (
    <div className="overflow-hidden rounded-lg border bg-sunken">
      {path && <div className="border-b px-3 py-1.5 font-mono text-xs text-muted-foreground">{path}</div>}
      <pre className="max-h-72 overflow-auto py-1 font-mono text-xs leading-relaxed">
        {lines(before).map((l, i) => (
          <div key={`-${i}`} className="tone-danger tone-text bg-danger/10 px-3">
            <span className="mr-2 select-none opacity-60">-</span>
            {l}
          </div>
        ))}
        {lines(after).map((l, i) => (
          <div key={`+${i}`} className="tone-success tone-text bg-success/10 px-3">
            <span className="mr-2 select-none opacity-60">+</span>
            {l}
          </div>
        ))}
      </pre>
    </div>
  )
}
