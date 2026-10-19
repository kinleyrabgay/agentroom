"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { FIELD_CLASS } from "./field";

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date & time",
  disabled,
}: {
  value?: Date;
  onChange: (date: Date) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  // True on the client only (portals need document.body).
  const mounted = React.useSyncExternalStore(subscribeNothing, () => true, () => false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  // Position popover relative to the trigger, flipping if it would overflow.
  // Reads the popover's actual measured size so the flip math matches reality
  // — hard-coded dimensions drift when calendar + time columns grow.
  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popoverRef.current;
    if (!trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const popW = pop.offsetWidth;
    const popH = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let left = r.left;
    if (left + popW > vw - margin) {
      left = Math.max(margin, vw - margin - popW);
    }

    let top = r.bottom + 4;
    if (top + popH > vh - margin && r.top - popH - 4 > margin) {
      top = r.top - popH - 4;
    }

    setPos({ top, left });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    // Two-pass: the popover first renders off-screen (pos reset on open) so we can measure, then reposition.
    const id = requestAnimationFrame(reposition);
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, reposition]);

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const base = value ?? new Date();
  const hour12 = ((base.getHours() + 11) % 12) + 1;
  const minute = base.getMinutes();
  const period: "AM" | "PM" = base.getHours() >= 12 ? "PM" : "AM";

  function withDate(mutate: (d: Date) => void): Date {
    const next = new Date(base);
    mutate(next);
    return next;
  }

  function setHour(h: number) {
    onChange(
      withDate((d) => {
        const newHour = period === "PM" ? (h % 12) + 12 : h % 12;
        d.setHours(newHour);
      }),
    );
  }

  function setMinute(m: number) {
    onChange(
      withDate((d) => {
        d.setMinutes(m);
      }),
    );
  }

  function setPeriod(p: "AM" | "PM") {
    onChange(
      withDate((d) => {
        const h12 = ((d.getHours() + 11) % 12) + 1;
        d.setHours(p === "PM" ? (h12 % 12) + 12 : h12 % 12);
      }),
    );
  }

  function setDay(picked: Date | undefined) {
    if (!picked) return;
    onChange(
      withDate((d) => {
        d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      }),
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) setPos(null);
          setOpen(!open);
        }}
        className={cn(
          FIELD_CLASS,
          "gap-2",
          !value && "text-muted-foreground",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left">
          {value ? format(value, "MM/dd/yyyy, h:mm aa") : placeholder}
        </span>
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={popoverRef}
              style={
                pos
                  ? { top: pos.top, left: pos.left, visibility: "visible" }
                  : { top: -9999, left: -9999, visibility: "hidden" }
              }
              className="fixed z-50 flex rounded-xl border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95"
            >
              <Calendar
                mode="single"
                selected={value}
                onSelect={setDay}
                defaultMonth={value ?? new Date()}
                captionLayout="dropdown"
              />
              <div className="flex gap-1 border-l p-2">
                <HourColumn selected={hour12} onSelect={setHour} />
                <MinuteColumn selected={minute} onSelect={setMinute} />
                <PeriodColumn selected={period} onSelect={setPeriod} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const subscribeNothing = () => () => {};

function ColumnShell({
  children,
  scrollKey,
}: {
  children: React.ReactNode;
  scrollKey: string | number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [scrollKey]);
  return (
    <div
      ref={ref}
      className="h-56 w-12 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex flex-col gap-0.5 py-2">{children}</div>
    </div>
  );
}

function CellButton({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      data-selected={selected}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1.5 text-sm font-medium transition-colors tabular-nums",
        selected
          ? "bg-primary text-primary-foreground"
          : "text-foreground/70 hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function HourColumn({ selected, onSelect }: { selected: number; onSelect: (v: number) => void }) {
  return (
    <ColumnShell scrollKey={selected}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
        <CellButton
          key={h}
          selected={h === selected}
          onClick={() => onSelect(h)}
          label={String(h).padStart(2, "0")}
        />
      ))}
    </ColumnShell>
  );
}

function MinuteColumn({ selected, onSelect }: { selected: number; onSelect: (v: number) => void }) {
  return (
    <ColumnShell scrollKey={selected}>
      {Array.from({ length: 60 }, (_, i) => i).map((m) => (
        <CellButton
          key={m}
          selected={m === selected}
          onClick={() => onSelect(m)}
          label={String(m).padStart(2, "0")}
        />
      ))}
    </ColumnShell>
  );
}

function PeriodColumn({
  selected,
  onSelect,
}: {
  selected: "AM" | "PM";
  onSelect: (v: "AM" | "PM") => void;
}) {
  return (
    <ColumnShell scrollKey={selected}>
      {(["PM", "AM"] as const).map((p) => (
        <CellButton
          key={p}
          selected={p === selected}
          onClick={() => onSelect(p)}
          label={p}
        />
      ))}
    </ColumnShell>
  );
}
