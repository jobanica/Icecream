import { fmtDate, fmtDateTime, num, peso } from "@/lib/format";
import { CAUSE_LABELS, type DiscrepancyCause } from "@/lib/types";
import { Pill } from "@/components/status";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Summary = any;

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-1 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="border-b pb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Audit summary. `partner` hides internal checklist notes (they are also stripped server-side). */
export function AuditSummaryView({ summary, partner = false }: { summary: Summary; partner?: boolean }) {
  if (!summary) return null;
  const t = summary.totals ?? {};
  const s = t.sales ?? {};
  const r = t.remittances ?? {};
  const w = t.three_way ?? {};
  const c = t.counter ?? {};
  const bySection: Record<string, Summary[]> = {};
  for (const item of summary.checklist ?? []) (bySection[item.section] ??= []).push(item);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-semibold">
            {summary.location?.code} · {summary.location?.store_name}
          </div>
          <div className="text-muted-foreground">
            {fmtDate(t.period_start)} – {fmtDate(t.period_end, { year: true })} · Auditor {summary.auditor ?? "—"} · {fmtDateTime(summary.completed_at)}
          </div>
        </div>
        <Pill t={summary.score?.passed === summary.score?.total ? "green" : "amber"} className="text-sm">
          Checklist {summary.score?.passed}/{summary.score?.total} passed
        </Pill>
      </div>

      <Section title="Sales & remittances">
        <Row label="Sales (net)" value={peso(s.net_centavos)} strong />
        <Row label="Cash / GCash / other" value={`${peso(s.cash_centavos)} / ${peso(s.gcash_centavos)} / ${peso(s.other_centavos)}`} />
        <Row label="Remitted (sent)" value={peso(r.sent_centavos)} />
        <Row label="Verified" value={peso(r.verified_centavos)} />
        <Row label="Outstanding" value={<span className={r.outstanding_centavos > 0 ? "text-red-600" : ""}>{peso(r.outstanding_centavos)}</span>} strong />
        <Row label="Cash over / short" value={peso(r.over_short_centavos)} />
        <Row label="Days reported / missing" value={`${s.reports} / ${s.missing_days}`} />
      </Section>

      <Section title="Servings (three-way)">
        <Row label="Machine counter total" value={num(w.counter_delta)} />
        <Row label="Reported servings (incl. freebies)" value={num(w.reported_servings)} />
        <Row label="Cones + cups used" value={`${num(w.container_servings)} (${num(w.cones_used)} cones, ${num(w.cups_used)} cups)`} />
        <Row label="Days matched / minor / major" value={`${w.matched_days} / ${w.minor_days} / ${w.major_days}`} />
        <Row label="Counter readings with photo" value={`${c.photos} of ${c.readings}`} />
        {(w.resolved ?? []).map((d: Summary) => (
          <p key={d.id} className="text-xs text-muted-foreground">
            {fmtDate(d.date)}: off by {d.max_diff} — {CAUSE_LABELS[d.cause as DiscrepancyCause] ?? d.cause}
            {d.notes ? ` (${d.notes})` : ""}
          </p>
        ))}
        {(w.unresolved ?? []).length > 0 && (
          <p className="text-xs text-red-600">{w.unresolved.length} discrepancy day(s) still unresolved</p>
        )}
      </Section>

      {(t.premix ?? []).length > 0 && (
        <Section title="Premix">
          {(t.premix as Summary[]).map((p) => (
            <Row key={p.item} label={`${p.item} used (expected from counter @ ${num(p.yield_servings)} servings/unit)`} value={num(p.expected_used, 2)} />
          ))}
        </Section>
      )}

      {(summary.inventory ?? []).length > 0 && (
        <Section title="Inventory count">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 text-right font-medium">System</th>
                  <th className="py-1 text-right font-medium">Actual</th>
                  <th className="py-1 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {(summary.inventory as Summary[]).map((i) => (
                  <tr key={i.item} className="border-t">
                    <td className="py-1">{i.item}</td>
                    <td className="py-1 text-right tabular-nums">{num(i.system_qty, 2)}</td>
                    <td className="py-1 text-right tabular-nums">{num(i.actual_qty, 2)}</td>
                    <td className={`py-1 text-right tabular-nums ${Number(i.variance) < 0 ? "text-red-600" : ""}`}>
                      {num(i.variance, 2)} {Number(i.variance_value_centavos) !== 0 && <span className="text-xs">({peso(i.variance_value_centavos)})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Findings & action items">
        {(summary.findings ?? []).length === 0 && <p className="text-sm text-muted-foreground">No findings.</p>}
        <ul className="space-y-2">
          {(summary.findings as Summary[] | undefined)?.map((f, i) => (
            <li key={i} className="text-sm">
              <Pill t={f.severity === "major" ? "red" : f.severity === "minor" ? "amber" : "blue"}>{f.severity}</Pill> {f.description}
              {f.action_item && <div className="pl-2 text-xs text-muted-foreground">→ {f.action_item}</div>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Checklist">
        {Object.entries(bySection).map(([section, items]) => (
          <div key={section} className="py-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{section}</div>
            <ul>
              {items.map((it: Summary) => (
                <li key={it.label} className="flex justify-between gap-2 py-0.5 text-sm">
                  <span>
                    {it.label}
                    {!partner && it.notes && <span className="block text-xs text-muted-foreground">{it.notes}</span>}
                  </span>
                  <span>{it.result === "pass" ? "✅" : it.result === "fail" ? "❌" : "n/a"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </div>
  );
}
