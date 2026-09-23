"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Large −/+ number input for counting on a small touch screen. */
export function Stepper({
  value,
  onChange,
  min = 0,
  step = 1,
  size = "lg",
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  size?: "lg" | "sm";
  ariaLabel: string;
}) {
  const btn = size === "lg" ? "size-12" : "size-9";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`Less ${ariaLabel}`}
        onClick={() => onChange(Math.max(min, value - step))}
        className={cn("flex items-center justify-center rounded-lg border bg-background active:bg-muted", btn)}
      >
        <Minus className="size-5" />
      </button>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
          onChange(Math.max(min, n));
        }}
        onFocus={(e) => e.target.select()}
        className={cn(
          "rounded-lg border bg-background text-center font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring",
          size === "lg" ? "h-12 w-20 text-xl" : "h-9 w-14 text-base",
        )}
      />
      <button
        type="button"
        aria-label={`More ${ariaLabel}`}
        onClick={() => onChange(value + step)}
        className={cn("flex items-center justify-center rounded-lg border bg-background active:bg-muted", btn)}
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
