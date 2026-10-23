"use client"

import { useRef, useState } from "react"
import { useTheme } from "next-themes"
import { CheckIcon, ClockIcon, ImageIcon, ImageOffIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { SettingsCard } from "@/features/settings/components/settings-card"
import { SettingsSection } from "@/features/settings/lib/constants"
import { ACCENTS, prepareImage, SCALE_RANGE, SCENES, sceneFor, sceneGradient, type AccentId, type SceneId, type WallpaperChoice } from "../lib/appearance"
import { useAppearance } from "../lib/store"

const swatch = (id: AccentId) => `oklch(0.68 ${ACCENTS[id].chroma + 0.02} ${ACCENTS[id].hue})`

/** Settings → Appearance: accent, wallpaper and text size. Personal to this browser. */
export function AppearanceSection() {
  const { appearance: a, update, reset, saved } = useAppearance()
  const dark = useTheme().resolvedTheme !== "light"
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const hasWallpaper = a.wallpaper !== "none" && (a.wallpaper !== "custom" || !!a.customImage)

  const upload = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith("image/")) return void toast.error("Pick an image file.")
    setBusy(true)
    try {
      const { dataUrl, hue } = await prepareImage(f)
      update({ wallpaper: "custom", customImage: dataUrl, customHue: hue })
      if (!useAppearance.getState().saved) toast.warning("That image is too large to remember; it shows until you reload.")
    } catch {
      toast.error("Couldn't read that image.")
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }

  return (
    <SettingsCard id={SettingsSection.Appearance}>
      <div className="space-y-6">
        <Row label="Accent" hint="Buttons, focus rings, highlights and charts.">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent colour">
            {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
              <button
                key={id}
                role="radio"
                aria-checked={a.accent === id}
                aria-label={ACCENTS[id].label}
                title={ACCENTS[id].label}
                onClick={() => update({ accent: id })}
                className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/40"
                style={{ background: swatch(id) }}
              >
                {a.accent === id && <CheckIcon className="size-3.5 text-white" />}
              </button>
            ))}
            <button
              role="radio"
              aria-checked={a.accent === "wallpaper"}
              disabled={!hasWallpaper}
              onClick={() => update({ accent: "wallpaper" })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                a.accent === "wallpaper" && "border-brand bg-brand/10 text-brand-ink"
              )}
              title={hasWallpaper ? "Take the colour from the wallpaper" : "Choose a wallpaper first"}
            >
              <ImageIcon className="size-3.5" /> From wallpaper
            </button>
          </div>
        </Row>

        <Row label="Wallpaper" hint="Shows behind the app; panels turn to frosted glass.">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Wallpaper">
            <Tile label="None" selected={a.wallpaper === "none"} onClick={() => update({ wallpaper: "none" })}>
              <ImageOffIcon className="size-4 text-muted-foreground" />
            </Tile>
            <Tile
              label="Time of day"
              selected={a.wallpaper === "time"}
              onClick={() => update({ wallpaper: "time" })}
              background={sceneGradient(sceneFor("time")!, dark)}
            >
              <ClockIcon className="size-4 text-white drop-shadow" />
            </Tile>
            {(Object.keys(SCENES) as SceneId[]).map((id) => (
              <Tile key={id} label={SCENES[id].label} selected={a.wallpaper === id} onClick={() => update({ wallpaper: id as WallpaperChoice })} background={sceneGradient(id, dark)} />
            ))}
            <Tile
              label={a.customImage ? "Your image" : "Upload"}
              selected={a.wallpaper === "custom"}
              onClick={() => (a.customImage ? update({ wallpaper: "custom" }) : file.current?.click())}
              background={a.customImage ? `url("${a.customImage}") center / cover` : undefined}
            >
              {!a.customImage && <UploadIcon className="size-4 text-muted-foreground" />}
            </Tile>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input ref={file} type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} aria-label="Upload a wallpaper image" />
            <Button size="xs" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
              <UploadIcon data-icon="inline-start" /> {busy ? "Preparing…" : a.customImage ? "Replace image" : "Use your own image"}
            </Button>
            {a.customImage && (
              <Button size="xs" variant="ghost" onClick={() => update({ customImage: undefined, customHue: undefined, wallpaper: a.wallpaper === "custom" ? "none" : a.wallpaper })}>
                Remove image
              </Button>
            )}
          </div>
        </Row>

        <Row label="Text size" hint="Scales the whole interface.">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={SCALE_RANGE.min}
              max={SCALE_RANGE.max}
              step={SCALE_RANGE.step}
              value={a.scale}
              onChange={(e) => update({ scale: Number(e.target.value) })}
              className="w-48 accent-[var(--brand)]"
              aria-label="Text size"
            />
            <span className="w-12 text-sm tabular-nums">{Math.round(a.scale * 100)}%</span>
            {a.scale !== 1 && (
              <Button size="xs" variant="ghost" onClick={() => update({ scale: 1 })}>
                100%
              </Button>
            )}
          </div>
        </Row>

        <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
          <span>{saved ? "Saved in this browser only." : "Couldn't save in this browser; it applies until you reload."}</span>
          <Button size="xs" variant="ghost" onClick={reset}>
            Reset to default
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Tile({ label, selected, onClick, background, children }: { label: string; selected: boolean; onClick: () => void; background?: string; children?: React.ReactNode }) {
  return (
    <button role="radio" aria-checked={selected} onClick={onClick} className="group space-y-1 text-left outline-none">
      <span
        className={cn(
          "grid aspect-[16/10] w-full place-items-center rounded-lg border bg-sunken ring-offset-2 ring-offset-background group-focus-visible:ring-2 group-focus-visible:ring-ring",
          selected && "ring-2 ring-brand"
        )}
        style={background ? { background } : undefined}
      >
        {children}
      </span>
      <span className={cn("block truncate text-xs", selected ? "font-medium" : "text-muted-foreground")}>{label}</span>
    </button>
  )
}
