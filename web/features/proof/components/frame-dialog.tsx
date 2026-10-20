"use client"

import type { ProofFrame } from "@shared"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/** One proof frame at full size. */
export function FrameDialog({ frame, src, onOpenChange }: { frame: ProofFrame | null; src: string; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!frame} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{frame?.label}</DialogTitle>
          <DialogDescription>{frame && (frame.step < 0 ? "After the page loaded" : `After step ${frame.step + 1}`)}</DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {frame && <img src={src} alt={frame.label} className="max-h-[75vh] w-full rounded-lg border object-contain" />}
      </DialogContent>
    </Dialog>
  )
}
