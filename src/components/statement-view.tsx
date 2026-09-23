import { fmtDate, num, peso } from "@/lib/format";
import { AuditSummaryView } from "@/components/audit-summary";

/* eslint-disable @typescript-eslint/no-explicit-any */
function Line({ label, value, strong, neg }: { label: string; value: number; strong?: boolean; neg?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${strong ? "border-t font-bold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{neg && value ? `−${peso(value)}` : peso(value)}</span>
    </div>
  );
}

/** How the partner payout was computed (from the immutable statement snapshot). */
export function StatementView({ snapshot, statementNo }: { snapshot: any; statementNo: string }) {
  const d = snapshot.deductions ?? {};
  const t = snapshot.totals ?? {};
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-muted-foreground">Statement {statementNo}</div>
        <div className="text-lg font-bold">
          {snapshot.location?.code} · {snapshot.location?.store_name}
        </div>
        <div className="text-sm">
          {fmtDate(snapshot.period_start)} – {fmtDate(snapshot.period_end, { year: true })} · Partner: {snapshot.location?.partner_name}
        </div>
      </div>

      <div className="rounded-xl bg-emerald-600 p-4 text-center text-white">
        <div className="text-sm opacity-90">Your share payable</div>
        <div className="text-4xl font-bold tabular-nums">{peso(snapshot.partner_payable_centavos)}</div>
      </div>

      <section>
        <h3 className="mb-1 text-sm font-bold uppercase text-muted-foreground">How it was computed</h3>
        <Line label="Total sales" value={t.total_sales_centavos} />
        <Line label="Product cost (premix, cones, cups, toppings used)" value={d.product_cost_centavos} neg />
        <Line label="Payment fees" value={d.payment_fees_centavos} neg />
        <Line label="Machine maintenance reserve" value={d.maintenance_reserve_centavos} neg />
        <Line label="Wastage / stock loss" value={d.wastage_centavos} neg />
        <Line label="Delivery cost" value={d.delivery_cost_centavos} neg />
        {d.other_deductions_centavos > 0 && <Line label="Other deductions" value={d.other_deductions_centavos} neg />}
        <Line label="Net profit" value={snapshot.net_profit_centavos} strong />
        <Line label={`Your share (${num(snapshot.partner_share_pct, 2)}%)`} value={snapshot.partner_share_centavos} />
        <Line label="Owner share" value={snapshot.owner_share_centavos} />
        {(snapshot.adjustments ?? []).map((a: any, i: number) => (
          <div key={i} className="flex justify-between gap-3 py-1 text-sm text-red-700">
            <span>Adjustment: {a.reason}</span>
            <span className="whitespace-nowrap tabular-nums">{a.amount_centavos < 0 ? `−${peso(-a.amount_centavos)}` : peso(a.amount_centavos)}</span>
          </div>
        ))}
        <Line label="Payable to you" value={snapshot.partner_payable_centavos} strong />
      </section>

      <section>
        <h3 className="mb-1 text-sm font-bold uppercase text-muted-foreground">Remittances</h3>
        <Line label="Sales" value={t.total_sales_centavos} />
        <Line label="Remitted and verified" value={t.verified_remittances_centavos} />
        <Line label="Outstanding" value={t.outstanding_centavos} strong />
      </section>

      {(d.cost_breakdown ?? []).length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-bold uppercase text-muted-foreground">Product cost detail</h3>
          {(d.cost_breakdown as any[]).map((c) => (
            <div key={c.item} className="flex justify-between py-0.5 text-sm">
              <span>
                {c.item}: {num(c.qty, 2)} {c.unit} × {peso(c.unit_cost_centavos)}
              </span>
              <span className="tabular-nums">{peso(c.cost_centavos)}</span>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3 className="mb-1 text-sm font-bold uppercase text-muted-foreground">Daily sales</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="font-medium">Date</th>
                <th className="text-right font-medium">Servings</th>
                <th className="text-right font-medium">Sales</th>
                <th className="text-right font-medium">Remitted</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.daily ?? []).map((r: any) => (
                <tr key={r.date} className="border-t">
                  <td className="py-1">{fmtDate(r.date)}</td>
                  <td className="py-1 text-right tabular-nums">{r.servings}</td>
                  <td className="py-1 text-right tabular-nums">{peso(r.net_sales_centavos)}</td>
                  <td className="py-1 text-right tabular-nums">{peso(r.remitted_centavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-sm">
          {(snapshot.sales_by_product ?? []).map((p: any) => (
            <div key={p.product} className="flex justify-between">
              <span>
                {p.product} × {p.qty}
                {p.free_qty > 0 ? ` (+${p.free_qty} free)` : ""}
              </span>
              <span className="tabular-nums">{peso(p.amount_centavos)}</span>
            </div>
          ))}
        </div>
      </section>

      {snapshot.audit_summary && (
        <section className="space-y-2">
          <h3 className="text-sm font-bold uppercase text-muted-foreground">Audit summary</h3>
          <AuditSummaryView summary={snapshot.audit_summary} partner />
        </section>
      )}
    </div>
  );
}
