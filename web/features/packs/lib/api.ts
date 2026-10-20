import type { InstalledSkillInfo, PackResult, PackView, RegistrySearch, SkillPreview } from "@shared"
import { request } from "@/lib/api/client"

const seg = encodeURIComponent

/** Team packs (Settings → Packs). */
export const packApi = {
  list: () => request<PackView[]>("GET", "/packs"),
  install: (name: string) => request<PackResult>("POST", `/packs/${seg(name)}/install`),
  update: (name: string) => request<PackResult>("POST", `/packs/${seg(name)}/update`),
  remove: (name: string) => request<PackResult>("DELETE", `/packs/${seg(name)}`),
}

/** The skill registry (Skills → Browse). Install is always preview first, then install that preview. */
export const registryApi = {
  search: (q: string) => request<RegistrySearch>("GET", `/registry/search?q=${seg(q)}`),
  installed: () => request<InstalledSkillInfo[]>("GET", "/registry/installed"),
  preview: (ref: string) => request<SkillPreview>("POST", "/registry/preview", { ref }),
  upload: (name: string, data: string) => request<SkillPreview>("POST", "/registry/upload", { name, data }),
  install: (id: string, overwrite: boolean) => request<{ name: string; source: string }>("POST", "/registry/install", { id, overwrite }),
  checkUpdate: (name: string) => request<{ preview: SkillPreview; changed: boolean }>("POST", `/registry/skills/${seg(name)}/check`),
}

/** Base64 of a File, for uploads. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** One line for a pack install/update result. */
export function describeResult(r: PackResult): string {
  const n = (a: string) => r.changes.filter((c) => c.action === a).length
  const parts = [
    n("created") && `${n("created")} added`,
    n("updated") + n("merged") && `${n("updated") + n("merged")} updated`,
    n("removed") && `${n("removed")} removed`,
    r.settings.applied.length && `${r.settings.applied.length} setting${r.settings.applied.length === 1 ? "" : "s"}`,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "Nothing to change"
}
