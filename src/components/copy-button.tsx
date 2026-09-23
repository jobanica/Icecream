"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\s/g, ""));
        } catch {
          /* old browsers: user can still read the number */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium active:bg-muted"
    >
      {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      {done ? "Copied" : label}
    </button>
  );
}
