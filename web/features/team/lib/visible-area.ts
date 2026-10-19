/** Selectors for the floating chrome drawn over the full-page Team canvas. */
const SIDEBAR = '[data-slot="sidebar-container"]'
const BOT_PANEL = "[data-bot-panel]"

const GAP = 24
const TOP_BAR = 72
const COMMAND_BAR = 110

export type Insets = { top: number; right: number; bottom: number; left: number }

/** Space taken by the floating sidebar / top bar / bot panel / command bar, so the team fits in what's visible. */
export function chromeInsets(): Insets {
  const width = window.innerWidth
  const sidebar = document.querySelector<HTMLElement>(SIDEBAR)?.getBoundingClientRect()
  const panel = document.querySelector<HTMLElement>(BOT_PANEL)?.getBoundingClientRect()
  return {
    top: TOP_BAR,
    bottom: COMMAND_BAR,
    left: sidebar && sidebar.width > 0 && sidebar.right > 0 ? sidebar.right + GAP : GAP,
    right: panel && panel.width > 0 ? Math.max(GAP, width - panel.left + GAP) : GAP,
  }
}

export const toPadding = (i: Insets) => ({
  top: `${Math.round(i.top)}px`,
  right: `${Math.round(i.right)}px`,
  bottom: `${Math.round(i.bottom)}px`,
  left: `${Math.round(i.left)}px`,
}) as const

export const CHROME_SELECTORS = { SIDEBAR, BOT_PANEL }
