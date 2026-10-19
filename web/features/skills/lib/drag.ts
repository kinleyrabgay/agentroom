import { DragType } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** Start dragging a library skill: sets global drag state and a custom chip as the drag image. */
export function startSkillDrag(e: React.DragEvent, skill: string) {
  e.dataTransfer.setData(DragType.Skill, skill)
  e.dataTransfer.effectAllowed = "copy"
  const chip = makeDragChip(skill)
  e.dataTransfer.setDragImage(chip, 16, 14)
  // The browser snapshots the element synchronously; remove it on the next frame.
  requestAnimationFrame(() => chip.remove())
  useAppStore.getState().setDraggingSkill(skill)
}

export function endSkillDrag() {
  useAppStore.getState().setDraggingSkill(null)
}

function makeDragChip(label: string) {
  const el = document.createElement("div")
  el.textContent = `✦ ${label}`
  const dark = document.documentElement.classList.contains("dark")
  Object.assign(el.style, {
    position: "fixed",
    top: "-1000px",
    left: "-1000px",
    padding: "4px 10px",
    borderRadius: "999px",
    font: "500 12px ui-monospace, SFMono-Regular, Menlo, monospace",
    background: dark ? "#fafafa" : "#171717",
    color: dark ? "#171717" : "#fafafa",
    boxShadow: "0 6px 16px rgba(0,0,0,.25)",
    whiteSpace: "nowrap",
  })
  document.body.appendChild(el)
  return el
}
