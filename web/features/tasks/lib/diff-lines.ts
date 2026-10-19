/** One rendered line of a unified diff, with old/new line numbers. */
export interface DiffLine {
  kind: "hunk" | "add" | "del" | "ctx"
  text: string
  oldNo?: number
  newNo?: number
}

/** Parse a single file's unified diff into lines (headers dropped, hunks kept as separators). */
export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      inHunk = true
      out.push({ kind: "hunk", text: hunk[3]?.trim() || `Lines ${newNo}+` })
      continue
    }
    if (!inHunk) continue
    if (raw.startsWith("+")) out.push({ kind: "add", text: raw.slice(1), newNo: newNo++ })
    else if (raw.startsWith("-")) out.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ })
    else if (raw.startsWith("\\")) continue
    else if (raw.startsWith(" ") || raw === "") out.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  // A trailing empty context line comes from the final newline, not the file.
  if (out.at(-1)?.kind === "ctx" && out.at(-1)?.text === "") out.pop()
  return out
}

/** Side-by-side rows: deletions and additions of the same block paired up. */
export function toSplit(lines: DiffLine[]): { left?: DiffLine; right?: DiffLine; hunk?: string }[] {
  const rows: { left?: DiffLine; right?: DiffLine; hunk?: string }[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] })
    dels = []
    adds = []
  }
  for (const l of lines) {
    if (l.kind === "del") dels.push(l)
    else if (l.kind === "add") adds.push(l)
    else {
      flush()
      if (l.kind === "hunk") rows.push({ hunk: l.text })
      else rows.push({ left: l, right: l })
    }
  }
  flush()
  return rows
}
