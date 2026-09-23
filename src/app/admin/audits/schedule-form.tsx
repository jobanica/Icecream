"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/format";
import { scheduleAudit } from "./actions";

/** Suggests the week right after the location's last audited period. */
export function ScheduleAuditForm({
  locations,
  nextStart,
  today,
}: {
  locations: { id: string; code: string; store_name: string }[];
  nextStart: Record<string, string>;
  today: string;
}) {
  const [loc, setLoc] = useState(locations[0]?.id ?? "");
  const start = nextStart[loc] ?? addDays(today, -7);
  const end = addDays(start, 6) < today ? addDays(start, 6) : addDays(today, -1);
  return (
    <ActionForm action={scheduleAudit} className="grid items-end gap-3 sm:grid-cols-5" key={loc}>
      <div className="sm:col-span-2">
        <label className="space-y-1">
          <span className="text-xs font-medium">Location</span>
          <select
            name="location_id"
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.store_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field label="Period start" name="period_start" type="date" defaultValue={start} />
      <Field label="Period end" name="period_end" type="date" defaultValue={end} />
      <Field label="Visit date" name="scheduled_for" type="date" defaultValue={today} />
      <Button type="submit" className="sm:col-span-5 sm:w-fit">
        Schedule audit
      </Button>
    </ActionForm>
  );
}
