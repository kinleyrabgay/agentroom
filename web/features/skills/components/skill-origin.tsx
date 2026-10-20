"use client"

import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import type { InstalledSkillInfo, SkillPreview } from "@shared"
import { Button } from "@/components/ui/button"
import { ToneBadge } from "@/components/kit/badge"
import { registryApi } from "@/features/packs/lib/api"

/** Where an installed library skill came from, whether you've edited it, and a way to check for a newer copy. */
export function SkillOrigin({ name, onUpdateAvailable }: { name: string; onUpdateAvailable: (preview: SkillPreview) => void }) {
  const [info, setInfo] = useState<InstalledSkillInfo | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let live = true
    registryApi
      .installed()
      .then((all) => live && setInfo(all.find((i) => i.name === name) ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [name])
  if (!info) return null
  const check = async () => {
    setChecking(true)
    try {
      const r = await registryApi.checkUpdate(name)
      if (r.changed) onUpdateAvailable(r.preview)
      else toast.success(`${name} is up to date`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-sunken px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        Installed from <span className="font-mono text-foreground">{info.source}</span>
        {info.version ? ` · ${info.version}` : ""}
      </span>
      {info.modified && <ToneBadge size="sm">Edited here</ToneBadge>}
      {!info.source.startsWith("file:") && (
        <Button size="xs" variant="ghost" className="ml-auto" onClick={check} disabled={checking}>
          <RefreshCwIcon data-icon="inline-start" className={checking ? "animate-spin" : undefined} /> Check for update
        </Button>
      )}
    </div>
  )
}
