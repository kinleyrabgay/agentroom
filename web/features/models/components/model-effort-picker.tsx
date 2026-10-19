"use client"

import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import type { EffortLevel, ModelOption } from "@shared"
import { cn } from "@/lib/utils"
import { useAppStore, LoadStatus } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ProviderMark } from "@/features/usage/components/provider-mark"
import { useModels } from "../hooks/use-models"
import { EFFORT_LABEL, effectiveModel, findModel, formatModel } from "../lib/models"

export interface ModelEffortValue {
  model?: string
  effort?: EffortLevel
}

const DEFAULT_EFFORT = "__default__"

/** Provider-aware model + effort picker. Unset fields fall back to the project defaults. */
export function ModelEffortPicker({ value, onChange }: { value: ModelEffortValue; onChange: (v: ModelEffortValue) => void }) {
  const { models, status } = useModels()
  const info = useAppStore((s) => s.info)
  const [open, setOpen] = useState(false)
  const provider = info?.provider ?? "claude"

  if (status === LoadStatus.Loading || status === LoadStatus.Idle) return <Skeleton className="h-10 w-full rounded-xl" />
  if (status === LoadStatus.Error || !models?.models.length) {
    return (
      <Input
        className="font-mono text-xs"
        placeholder="project default"
        value={value.model ?? ""}
        onChange={(e) => onChange({ ...value, model: e.target.value || undefined })}
      />
    )
  }

  const current = effectiveModel(models, value, info?.config)
  const selected = findModel(models, value.model ?? info?.config.model)
  const efforts = selected?.efforts ?? []
  const projectLabel = formatModel(effectiveModel(models, {}, info?.config))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-10 w-full justify-start gap-2 rounded-xl px-3 font-normal">
          <ProviderMark provider={provider} className="size-4" />
          <span className="truncate">
            {current.inherited && <span className="text-muted-foreground">Project default · </span>}
            {formatModel(current)}
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-80 p-0">
        <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {models.provider} models
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          <ModelRow
            label="Project default"
            description={projectLabel}
            selected={!value.model}
            onSelect={() => onChange({ model: undefined, effort: value.effort })}
          />
          {models.models.map((m) => (
            <ModelRow
              key={m.value}
              label={m.label}
              description={m.description}
              selected={value.model === m.value}
              onSelect={() => onChange({ model: m.value, effort: keepEffort(m, value.effort) })}
            />
          ))}
        </ul>
        {efforts.length > 0 && (
          <div className="border-t p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Effort</span>
              <span className="text-[10px] text-muted-foreground">Higher effort thinks longer and costs more</span>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="w-full flex-wrap"
              value={value.effort ?? DEFAULT_EFFORT}
              onValueChange={(v) => v && onChange({ ...value, effort: v === DEFAULT_EFFORT ? undefined : (v as EffortLevel) })}
            >
              <ToggleGroupItem value={DEFAULT_EFFORT} className="flex-1 text-xs">Default</ToggleGroupItem>
              {efforts.map((e) => (
                <ToggleGroupItem key={e} value={e} className="flex-1 text-xs">
                  {EFFORT_LABEL[e]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Keep the chosen effort only if the new model supports it. */
function keepEffort(model: ModelOption, effort: EffortLevel | undefined) {
  return effort && model.efforts.includes(effort) ? effort : undefined
}

function ModelRow({ label, description, selected, onSelect }: { label: string; description: string; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted", selected && "bg-muted/60")}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm">{label}</div>
          <div className="truncate text-xs text-muted-foreground">{description}</div>
        </div>
        <CheckIcon className={cn("mt-0.5 size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      </button>
    </li>
  )
}
