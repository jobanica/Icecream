import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fmtDate } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Built-in PDF fonts have no ₱ glyph, so amounts are written as "PHP 1,234.00".
const php = (c: number | null | undefined) =>
  `PHP ${(Number(c ?? 0) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const neg = (c: number) => (c ? `(${php(c)})` : php(0));

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4, paddingBottom: 2, borderBottom: "1pt solid #999", textTransform: "uppercase" },
  muted: { color: "#666" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderTop: "1pt solid #111", fontFamily: "Helvetica-Bold" },
  payable: { marginTop: 10, padding: 10, backgroundColor: "#059669", color: "white", flexDirection: "row", justifyContent: "space-between", fontSize: 13, fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", borderBottom: "1pt solid #999", paddingVertical: 2, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #ddd", paddingVertical: 2 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: "#888", flexDirection: "row", justifyContent: "space-between" },
});

function Row({ label, value, style }: { label: string; value: string; style?: any }) {
  return (
    <View style={[s.row, style]}>
      <Text style={{ maxWidth: "75%" }}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function StatementDoc({ st, businessName }: { st: any; businessName: string }) {
  const sn = st.snapshot;
  const d = sn.deductions ?? {};
  const t = sn.totals ?? {};
  const a = sn.audit_summary;
  const w = a?.totals?.three_way ?? {};
  return (
    <Document title={`Statement ${st.statement_no}`} author={businessName}>
      <Page size="A4" style={s.page}>
        <Text style={s.muted}>{businessName} · Partner profit-share statement</Text>
        <Text style={s.h1}>
          {sn.location?.code} · {sn.location?.store_name}
        </Text>
        <Text>
          Partner: {sn.location?.partner_name} · Period {fmtDate(sn.period_start)} – {fmtDate(sn.period_end, { year: true })} · Statement {st.statement_no}
        </Text>

        <View style={s.payable}>
          <Text>Partner share payable</Text>
          <Text>{php(sn.partner_payable_centavos)}</Text>
        </View>

        <Text style={s.h2}>How the payout was computed</Text>
        <Row label="Total sales" value={php(t.total_sales_centavos)} />
        <Row label="Less product cost (premix, cones, cups, toppings used)" value={neg(d.product_cost_centavos)} />
        <Row label="Less payment fees" value={neg(d.payment_fees_centavos)} />
        <Row label="Less machine maintenance reserve" value={neg(d.maintenance_reserve_centavos)} />
        <Row label="Less wastage / stock loss" value={neg(d.wastage_centavos)} />
        <Row label="Less delivery cost" value={neg(d.delivery_cost_centavos)} />
        {d.other_deductions_centavos > 0 && <Row label="Less other deductions" value={neg(d.other_deductions_centavos)} />}
        <View style={s.total}>
          <Text>Net profit</Text>
          <Text>{php(sn.net_profit_centavos)}</Text>
        </View>
        <Row label={`Partner share (${Number(sn.partner_share_pct)}%)`} value={php(sn.partner_share_centavos)} />
        <Row label="Owner share" value={php(sn.owner_share_centavos)} style={s.muted} />
        {(sn.adjustments ?? []).map((x: any, i: number) => (
          <Row key={i} label={`Adjustment: ${x.reason}`} value={x.amount_centavos < 0 ? `(${php(-x.amount_centavos)})` : php(x.amount_centavos)} />
        ))}
        <View style={s.total}>
          <Text>Payable to partner</Text>
          <Text>{php(sn.partner_payable_centavos)}</Text>
        </View>

        <Text style={s.h2}>Remittances</Text>
        <Row label="Sales for the period" value={php(t.total_sales_centavos)} />
        <Row label="Remitted and verified" value={php(t.verified_remittances_centavos)} />
        <Row label="Outstanding" value={php(t.outstanding_centavos)} style={s.bold} />

        {(d.cost_breakdown ?? []).length > 0 && (
          <>
            <Text style={s.h2}>Product cost detail</Text>
            {(d.cost_breakdown as any[]).map((c) => (
              <Row key={c.item} label={`${c.item}: ${Number(c.qty).toFixed(2)} ${c.unit} x ${php(c.unit_cost_centavos)}`} value={php(c.cost_centavos)} />
            ))}
          </>
        )}

        <Text style={s.h2}>Daily sales</Text>
        <View style={s.th}>
          <Text style={{ width: "30%" }}>Date</Text>
          <Text style={{ width: "15%", textAlign: "right" }}>Servings</Text>
          <Text style={{ width: "20%", textAlign: "right" }}>Sales</Text>
          <Text style={{ width: "20%", textAlign: "right" }}>Remitted</Text>
          <Text style={{ width: "15%", textAlign: "right" }}>Status</Text>
        </View>
        {(sn.daily ?? []).map((r: any) => (
          <View key={r.date} style={s.tr} wrap={false}>
            <Text style={{ width: "30%" }}>
              {fmtDate(r.date)}
              {r.type === "closed" ? " (closed)" : ""}
            </Text>
            <Text style={{ width: "15%", textAlign: "right" }}>{r.servings}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>{php(r.net_sales_centavos)}</Text>
            <Text style={{ width: "20%", textAlign: "right" }}>{php(r.remitted_centavos)}</Text>
            <Text style={{ width: "15%", textAlign: "right" }}>{r.remittance_status}</Text>
          </View>
        ))}
        {(sn.sales_by_product ?? []).map((p: any) => (
          <Row key={p.product} label={`${p.product} x ${p.qty}${p.free_qty ? ` (+${p.free_qty} free)` : ""}`} value={php(p.amount_centavos)} />
        ))}

        {a && (
          <View break>
            <Text style={s.h2}>Audit summary</Text>
            <Text>
              Auditor {a.auditor ?? "-"} · checklist {a.score?.passed}/{a.score?.total} passed
            </Text>
            <Row label="Machine counter total (servings)" value={String(w.counter_delta ?? 0)} />
            <Row label="Reported servings (incl. freebies)" value={String(w.reported_servings ?? 0)} />
            <Row label="Cones + cups used" value={String(w.container_servings ?? 0)} />
            <Row label="Days matched / minor / major" value={`${w.matched_days ?? 0} / ${w.minor_days ?? 0} / ${w.major_days ?? 0}`} />
            <Row label="Cash over / short" value={php(a.totals?.remittances?.over_short_centavos)} />
            {(a.inventory ?? []).length > 0 && (
              <>
                <Text style={[s.bold, { marginTop: 6 }]}>Inventory count</Text>
                {(a.inventory as any[]).map((i) => (
                  <Row
                    key={i.item}
                    label={`${i.item}: system ${Number(i.system_qty).toFixed(2)}, actual ${Number(i.actual_qty).toFixed(2)}`}
                    value={`variance ${(Number(i.variance) + 0).toFixed(2).replace(/^-0\.00$/, "0.00")} ${i.unit}`}
                  />
                ))}
              </>
            )}
            <Text style={[s.bold, { marginTop: 6 }]}>Findings & action items</Text>
            {(a.findings ?? []).length === 0 && <Text>No findings.</Text>}
            {(a.findings ?? []).map((f: any, i: number) => (
              <View key={i} style={{ marginBottom: 3 }}>
                <Text>
                  [{String(f.severity).toUpperCase()}] {f.description}
                </Text>
                {f.action_item && <Text style={s.muted}> Action: {f.action_item}</Text>}
              </View>
            ))}
            <Text style={[s.bold, { marginTop: 6 }]}>Checklist</Text>
            {(a.checklist ?? []).map((c: any, i: number) => (
              <Row key={i} label={`${String(c.section).toUpperCase()} · ${c.label}`} value={c.result === "pass" ? "PASS" : c.result === "fail" ? "FAIL" : "N/A"} />
            ))}
          </View>
        )}

        {st.acknowledged_at && (
          <Text style={{ marginTop: 12 }}>
            Acknowledged by partner on {new Date(st.acknowledged_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
            {st.acknowledgment_note ? ` — "${st.acknowledgment_note}"` : ""}
          </Text>
        )}
        <View style={s.footer} fixed>
          <Text>
            {st.statement_no} · issued {new Date(st.issued_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderStatementPdf(st: any, businessName: string) {
  return renderToBuffer(<StatementDoc st={st} businessName={businessName} />);
}
