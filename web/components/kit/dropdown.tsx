"use client";

import React from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { FIELD_CLASS } from "./field";

export interface DropdownData<T = string | number> {
  label: string;
  value: T;
  sublabel?: string;
}

interface DropdownComponentProps<T> {
  datas: DropdownData<T>[];
  hint?: string;
  placeholder?: string;
  notfound?: string;
  popoverWidth?: string | number;
  popoverHeight?: string | number;

  multiple?: boolean;
  selectedValue?: T | T[];
  disabled?: boolean;
  showSearch?: boolean;
  displayLimit?: number;
  className?: string;

  /** "field" (default): full-width form control. "pill": compact filter chip, `Label: Value`. */
  variant?: "field" | "pill";
  /** Pill prefix, e.g. "Status". */
  label?: string;
  /** Pill differs from its default: highlighted so active filters stand out. */
  active?: boolean;

  onSelect?: (value: T | T[]) => void;
}

/** Searchable single/multi select (Popover + Command). The standard dropdown for forms and filter bars. */
export function Dropdown<T extends string | number>({
  datas,
  hint,
  placeholder,
  notfound,
  popoverWidth,
  popoverHeight,
  selectedValue,
  disabled,
  showSearch = true,
  multiple = false,
  displayLimit = 3,
  className,
  variant = "field",
  label,
  active,
  onSelect,
}: DropdownComponentProps<T>) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();

  const selectedValues = React.useMemo<T[]>(
    () =>
      multiple
        ? ((selectedValue as T[]) ?? [])
        : selectedValue !== undefined && selectedValue !== null
          ? [selectedValue as T]
          : [],
    [selectedValue, multiple],
  );

  const toggleValue = (value: T) => {
    if (!multiple) {
      onSelect?.(value);
      setOpen(false);
      return;
    }

    const exists = selectedValues.includes(value);
    const newValues = exists
      ? selectedValues.filter((v) => v !== value)
      : [...selectedValues, value];

    onSelect?.(newValues);
  };

  const getDisplayText = () => {
    if (selectedValues.length === 0) return placeholder;

    if (!multiple) {
      return (
        datas.find((d) => d.value === selectedValues[0])?.label ?? placeholder
      );
    }

    const selectedLabels = selectedValues
      .map((val) => datas.find((d) => d.value === val)?.label)
      .filter((l): l is string => !!l);

    if (selectedLabels.length <= displayLimit) {
      return selectedLabels.join(", ");
    }

    const firstLabels = selectedLabels.slice(0, displayLimit).join(", ");
    const remainingCount = selectedValues.length - displayLimit;
    return `${firstLabels} (+${remainingCount} more)`;
  };

  const pill = variant === "pill";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {pill ? (
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            className={cn(
              "inline-flex h-8 max-w-64 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
              active
                ? "tone-brand tone-soft"
                : "bg-surface text-muted-foreground",
              className,
            )}
          >
            {label && (
              <span className={cn(active && "opacity-80")}>{label}</span>
            )}
            <span className="truncate font-medium text-foreground">
              {getDisplayText()}
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        ) : (
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            className={cn(
              FIELD_CLASS,
              "justify-between gap-2 text-left font-normal",
              selectedValues.length === 0 && "text-muted-foreground",
              className,
            )}
          >
            <span className="block truncate">{getDisplayText()}</span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        id={listId}
        align="start"
        className={cn(
          "p-0",
          !popoverWidth && !pill && "w-(--radix-popover-trigger-width)",
          !popoverWidth && pill && "w-60",
        )}
        style={popoverWidth != null ? { width: popoverWidth } : undefined}
      >
        <Command>
          {showSearch && <CommandInput placeholder={hint} />}
          <CommandList
            style={{
              maxHeight:
                typeof popoverHeight === "number"
                  ? `${popoverHeight}px`
                  : popoverHeight || "300px",
            }}
          >
            <CommandEmpty>{notfound ?? "No results."}</CommandEmpty>

            <CommandGroup>
              {datas.map((data) => {
                const isSelected = selectedValues.includes(data.value);
                const searchValue = `${data.label} ${data.sublabel ?? ""}`;

                return (
                  <CommandItem
                    key={String(data.value)}
                    value={searchValue}
                    onSelect={() => toggleValue(data.value)}
                    className="flex items-center gap-2"
                  >
                    {multiple ? (
                      <Checkbox checked={isSelected} />
                    ) : (
                      <Check
                        className={cn(
                          "h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{data.label}</div>
                      {data.sublabel ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {data.sublabel}
                        </div>
                      ) : null}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default Dropdown;
