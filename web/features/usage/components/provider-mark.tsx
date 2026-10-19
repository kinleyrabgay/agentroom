import { CpuIcon } from "lucide-react"
import { isClaude } from "../constants"

/** Claude: a warm eight-ray spark. Other providers: a neutral chip glyph. */
export function ProviderMark({ provider, className, mono = false }: { provider: string | undefined; className?: string; mono?: boolean }) {
  if (!isClaude(provider)) return <CpuIcon className={className} />
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <g stroke={mono ? "currentColor" : "var(--claude, #d97757)"} strokeWidth="2.6" strokeLinecap="round">
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1="12" y1="3" x2="12" y2="21" transform={`rotate(${a} 12 12)`} />
        ))}
      </g>
    </svg>
  )
}
