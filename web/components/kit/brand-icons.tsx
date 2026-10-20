import type { SVGProps } from "react"

/** GitHub's mark (lucide dropped brand icons). Sized and coloured like a lucide icon. */
export function GithubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

/** Linear's mark (a disc cut by diagonal strokes), single colour. */
export function LinearMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M1.3 14.3 9.7 22.7A11 11 0 0 1 1.3 14.3Zm-.3-3 11.7 11.7a11 11 0 0 0 2.2-.4L1.4 9.1a11 11 0 0 0-.4 2.2Zm1.2-4.4 14.9 14.9a11 11 0 0 0 1.6-1L3.2 5.3a11 11 0 0 0-1 1.6ZM4.6 3.9A11 11 0 1 1 20.1 19.4Z" />
    </svg>
  )
}

/** Jira's mark (two stacked chevrons), single colour. */
export function JiraMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M22.2 11.3 12.7 1.8 12 1.1 4.8 8.3 1.8 11.3a1 1 0 0 0 0 1.4l6.5 6.5L12 22.9l7.2-7.2.1-.1 2.9-2.9a1 1 0 0 0 0-1.4ZM12 15.1 8.9 12 12 8.9l3.1 3.1Z" />
    </svg>
  )
}

/** Microsoft Teams' mark (simplified "T" tile), single colour. */
export function TeamsMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M19.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM23 9h-5.2c.1.4.2.8.2 1.2V17a5 5 0 0 1-.4 1.9A4.2 4.2 0 0 0 23 15V9.6a.6.6 0 0 0-.6-.6ZM12.5 6.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM15.8 8H4.2A1.2 1.2 0 0 0 3 9.2v8.3A6 6 0 0 0 9 23.5a6 6 0 0 0 7.5-5.8V9.2A1.2 1.2 0 0 0 15.8 8ZM1.3 6h9.4c.7 0 1.3.6 1.3 1.3v9.4c0 .7-.6 1.3-1.3 1.3H1.3C.6 18 0 17.4 0 16.7V7.3C0 6.6.6 6 1.3 6Zm2 3.2v1.4h1.9V16h1.6v-5.4h1.9V9.2Z" />
    </svg>
  )
}
