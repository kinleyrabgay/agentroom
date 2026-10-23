/**
 * Appearance: the accent colour, an optional wallpaper behind glass panels, and text size.
 * Personal to this browser (localStorage). Everything is turned into one stylesheet, cached so the
 * boot script in the layout can paint it before React runs (no flash of the default teal).
 */

export const ACCENTS = {
  teal: { label: "Teal", hue: 195, chroma: 0.11 },
  blue: { label: "Blue", hue: 252, chroma: 0.14 },
  violet: { label: "Violet", hue: 295, chroma: 0.15 },
  pink: { label: "Pink", hue: 350, chroma: 0.15 },
  orange: { label: "Orange", hue: 45, chroma: 0.15 },
  amber: { label: "Amber", hue: 80, chroma: 0.14 },
  green: { label: "Green", hue: 150, chroma: 0.13 },
} as const
export type AccentId = keyof typeof ACCENTS

/** Built-in scenes: layered gradients, so nothing is downloaded. `hues` are [glow, sky, ground]. */
export const SCENES = {
  aurora: { label: "Aurora", hues: [160, 275, 230] },
  dusk: { label: "Dusk", hues: [35, 310, 265] },
  ocean: { label: "Ocean", hues: [200, 230, 185] },
  forest: { label: "Forest", hues: [130, 95, 160] },
  ember: { label: "Ember", hues: [30, 15, 55] },
  bloom: { label: "Bloom", hues: [345, 20, 300] },
  nebula: { label: "Nebula", hues: [285, 225, 320] },
  dawn: { label: "Dawn", hues: [65, 25, 210] },
} as const
export type SceneId = keyof typeof SCENES

/** "Time of day" picks a scene by the clock, switching at 06:00, 12:00 and 18:00. */
export const TIME_OF_DAY: { from: number; scene: SceneId }[] = [
  { from: 0, scene: "nebula" },
  { from: 6, scene: "dawn" },
  { from: 12, scene: "ocean" },
  { from: 18, scene: "dusk" },
]

export type WallpaperChoice = "none" | "time" | "custom" | SceneId

export interface Appearance {
  /** A preset, or the wallpaper's own colour. */
  accent: AccentId | "wallpaper"
  wallpaper: WallpaperChoice
  /** Your own image (a downscaled data: URL), for wallpaper "custom". */
  customImage?: string
  /** Hue found in the custom image, for the wallpaper accent. */
  customHue?: number
  /** Text and UI size, 0.85–1.25. */
  scale: number
}

export const DEFAULT_APPEARANCE: Appearance = { accent: "teal", wallpaper: "none", scale: 1 }
export const SCALE_RANGE = { min: 0.85, max: 1.25, step: 0.05 }

const KEY = "agentroom.appearance"
/** The computed stylesheet, read by the boot script in the layout before first paint. */
export const CSS_KEY = "agentroom.appearance.css"
export const STYLE_ID = "agentroom-appearance"

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_APPEARANCE
    const v = JSON.parse(raw) as Partial<Appearance>
    return { ...DEFAULT_APPEARANCE, ...v, scale: clampScale(v.scale ?? 1) }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearance(a: Appearance): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(a))
    return true
  } catch {
    // Storage full (a large image) or blocked: the look still applies to this tab.
    return false
  }
}

export const clampScale = (n: number) => Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, Number.isFinite(n) ? n : 1))

/** The scene shown now: the chosen one, or the time-of-day one. */
export function sceneFor(choice: WallpaperChoice, date = new Date()): SceneId | null {
  if (choice === "time") {
    const h = date.getHours()
    return [...TIME_OF_DAY].reverse().find((t) => h >= t.from)!.scene
  }
  return choice in SCENES ? (choice as SceneId) : null
}

/** Milliseconds until the next time-of-day switch. */
export function msToNextSwitch(date = new Date()): number {
  const h = date.getHours()
  const next = TIME_OF_DAY.find((t) => t.from > h)?.from ?? 24
  const at = new Date(date)
  at.setHours(next, 0, 0, 0)
  return at.getTime() - date.getTime()
}

const fmt = (n: number) => Number(n.toFixed(3))
const oklch = (l: number, c: number, h: number, a?: number) => `oklch(${fmt(l)} ${fmt(c)} ${fmt(h)}${a === undefined ? "" : ` / ${fmt(a)}`})`

/** Accent tokens for one theme, from a hue and chroma (chroma clamped so any source stays legible). */
export function accentTokens(hue: number, chroma: number, dark: boolean): Record<string, string> {
  const c = Math.min(0.19, Math.max(0.09, chroma))
  const brand = dark ? oklch(0.77, c, hue) : oklch(0.6, c, hue)
  return {
    "--brand": brand,
    "--brand-ink": dark ? oklch(0.82, c * 0.9, hue) : oklch(0.45, c * 0.85, hue),
    "--brand-foreground": dark ? oklch(0.2, 0.03, hue) : oklch(0.99, 0.01, hue),
    "--ring": dark ? oklch(0.75, c, hue) : oklch(0.62, c, hue),
    "--sidebar-primary": brand,
    "--sidebar-primary-foreground": dark ? oklch(0.2, 0.03, hue) : oklch(0.99, 0.01, hue),
    "--sidebar-ring": dark ? oklch(0.75, c, hue) : oklch(0.62, c, hue),
    "--chart-1": brand,
  }
}

/** A scene as layered gradients for one theme: soft glows over a sky-to-ground wash. */
export function sceneGradient(scene: SceneId, dark: boolean): string {
  const [glow, sky, ground] = SCENES[scene].hues
  const l = dark ? [0.42, 0.24, 0.17] : [0.9, 0.95, 0.88]
  const c = dark ? [0.13, 0.08, 0.06] : [0.08, 0.04, 0.05]
  return [
    `radial-gradient(60% 50% at 18% 12%, ${oklch(l[0]!, c[0]!, glow, 0.85)}, transparent 70%)`,
    `radial-gradient(55% 45% at 85% 25%, ${oklch(l[0]! - (dark ? 0.06 : -0.02), c[0]! * 0.9, sky, 0.7)}, transparent 70%)`,
    `radial-gradient(70% 55% at 60% 100%, ${oklch(l[2]! + (dark ? 0.06 : -0.02), c[2]! * 1.4, ground, 0.8)}, transparent 72%)`,
    `linear-gradient(170deg, ${oklch(l[1]!, c[1]!, sky)}, ${oklch(l[2]!, c[2]!, ground)})`,
  ].join(", ")
}

/** The accent hue and chroma this appearance uses. */
function accentSource(a: Appearance, scene: SceneId | null): { hue: number; chroma: number } {
  if (a.accent === "wallpaper") {
    if (scene) return { hue: SCENES[scene].hues[0], chroma: 0.14 }
    if (a.wallpaper === "custom" && a.customHue !== undefined) return { hue: a.customHue, chroma: 0.14 }
    return ACCENTS.teal
  }
  return ACCENTS[a.accent] ?? ACCENTS.teal
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`

/** The whole look as one stylesheet (both themes), plus the attributes the glass rules key on. */
export function buildStylesheet(a: Appearance, date = new Date()): { css: string; wallpaper: boolean } {
  const scene = sceneFor(a.wallpaper, date)
  const { hue, chroma } = accentSource(a, scene)
  const custom = a.wallpaper === "custom" && a.customImage ? `url("${a.customImage}") center / cover no-repeat` : null
  const wallpaper = !!(scene || custom)
  const parts = [
    block("html:root", { ...accentTokens(hue, chroma, false), "--ui-scale": String(clampScale(a.scale)) }),
    block("html.dark", accentTokens(hue, chroma, true)),
  ]
  if (wallpaper) {
    parts.push(block("html:root", { "--wallpaper": custom ?? sceneGradient(scene!, false) }))
    parts.push(block("html.dark", { "--wallpaper": custom ?? sceneGradient(scene!, true) }))
  }
  return { css: parts.join("\n"), wallpaper }
}

/** Paint it: replace the appearance stylesheet, flag the wallpaper for the glass rules, cache for next boot. */
export function applyAppearance(a: Appearance, date = new Date()) {
  const { css, wallpaper } = buildStylesheet(a, date)
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement("style")
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
  document.documentElement.toggleAttribute("data-wallpaper", wallpaper)
  try {
    localStorage.setItem(CSS_KEY, JSON.stringify({ css, wallpaper }))
  } catch {
    // Not cached: the next load shows the default for a moment.
  }
}

/** Runs inline in <head> before first paint: applies the cached stylesheet. Keep it tiny and self-contained. */
export const BOOT_SCRIPT = `try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(CSS_KEY)})||"null");if(a&&a.css){var s=document.createElement("style");s.id=${JSON.stringify(STYLE_ID)};s.textContent=a.css;document.head.appendChild(s);if(a.wallpaper)document.documentElement.setAttribute("data-wallpaper","")}}catch(e){}`

// ---------- your own image ----------

/** Downscale an image to at most `max` px on its long edge as JPEG, so it fits in storage. */
export async function prepareImage(file: File, max = 1920): Promise<{ dataUrl: string; hue: number | undefined }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const hue = dominantHue(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), hue }
}

/** sRGB (0–255) → OKLCH. */
export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(bb, a) * 180) / Math.PI
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h }
}

/**
 * The image's most prominent colourful hue: pixels binned into 24 hue bins, each weighted by chroma²
 * (greys barely count), neighbouring bins sharing score. Undefined for a grey image.
 */
export function dominantHue(pixels: Uint8ClampedArray, stride = 16): number | undefined {
  const bins = new Float64Array(24)
  const sums = new Float64Array(24)
  for (let i = 0; i < pixels.length; i += 4 * stride) {
    const { c, h } = rgbToOklch(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
    if (c < 0.03) continue
    const bin = Math.floor(h / 15) % 24
    bins[bin] += c * c
    sums[bin] += h * c * c
  }
  let best = -1
  let score = 0
  for (let i = 0; i < 24; i++) {
    const s = bins[i]! + 0.5 * (bins[(i + 23) % 24]! + bins[(i + 1) % 24]!)
    if (s > score) {
      score = s
      best = i
    }
  }
  return best < 0 || !bins[best] ? undefined : sums[best]! / bins[best]!
}
