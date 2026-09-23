"use client";

import { useMemo, useRef, useState } from "react";
import { fmtDate, num, peso } from "@/lib/format";

/**
 * Small dependency-free SVG chart: one y-axis, line or bar marks, crosshair
 * tooltip on hover/tap, legend + end-of-line labels, and a table view.
 * Colors are the reference categorical palette's first slots (blue, orange,
 * aqua), which validate for colorblind separation as a set.
 */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"] as const;

type Series = { key: string; label: string; values: (number | null)[]; color?: string };

// Secondary encoding: identical values draw on top of each other, so each line
// also gets its own dash pattern (and the legend shows it).
const DASHES = [undefined, "7 4", "2 4"] as const;

export function TrendChart({
  dates,
  series,
  kind = "line",
  unit = "count",
  height = 220,
  title,
}: {
  dates: string[];
  series: Series[];
  kind?: "line" | "bar";
  unit?: "count" | "peso";
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 640;
  const H = height;
  const pad = { l: 48, r: kind === "line" && series.length > 1 ? 70 : 12, t: 10, b: 24 };
  const fmt = (v: number | null) => (v == null ? "—" : unit === "peso" ? peso(v) : num(v));
  const fmtAxis = (v: number) => {
    if (unit !== "peso") return num(v);
    const p = v / 100;
    return p >= 1000 ? `₱${(p / 1000).toFixed(p < 10000 ? 1 : 0)}k` : `₱${num(p)}`;
  };

  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length], dash: DASHES[i % DASHES.length] }));
  const max = useMemo(() => {
    const m = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null)));
    if (m === 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / mag) * mag;
  }, [series]);
  const n = dates.length;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : kind === "bar" ? (iw / n) * (i + 0.5) : (iw / (n - 1)) * i);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  function onMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  }

  // end-of-line labels, nudged apart so they never overlap
  const labelY: Record<string, number> = {};
  {
    const ends = colored
      .map((s) => {
        const i = s.values.map((v, j) => (v == null ? -1 : j)).filter((j) => j >= 0).pop();
        return i == null ? null : { key: s.key, y: y(s.values[i]!) };
      })
      .filter((e): e is { key: string; y: number } => e != null)
      .sort((a, b) => a.y - b.y);
    for (let k = 0; k < ends.length; k++) {
      if (k > 0 && ends[k].y - ends[k - 1].y < 12) ends[k].y = ends[k - 1].y + 12;
      labelY[ends[k].key] = ends[k].y;
    }
  }

  const barW = Math.max(3, Math.min(24, (iw / Math.max(n, 1)) * 0.6));

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {colored.length > 1 &&
            colored.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <svg width="18" height="6" aria-hidden>
                  <line x1="1" x2="17" y1="3" y2="3" stroke={s.color} strokeWidth={2.5} strokeDasharray={kind === "line" ? s.dash : undefined} strokeLinecap="round" />
                </svg>
                {s.label}
              </span>
            ))}
          <button type="button" className="underline" onClick={() => setTable(!table)}>
            {table ? "Chart" : "Table"}
          </button>
        </span>
      </figcaption>

      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Date</th>
                {colored.map((s) => (
                  <th key={s.key} className="py-1 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d, i) => (
                <tr key={d} className="border-t">
                  <td className="py-1">{fmtDate(d)}</td>
                  {colored.map((s) => (
                    <td key={s.key} className="py-1 text-right tabular-nums">
                      {fmt(s.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none select-none"
            role="img"
            aria-label={title}
            onMouseMove={(e) => onMove(e.clientX)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={(e) => onMove(e.touches[0].clientX)}
            onTouchMove={(e) => onMove(e.touches[0].clientX)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.1} />
                <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.55}>
                  {fmtAxis(t)}
                </text>
              </g>
            ))}
            {dates.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.55}>
                  {fmtDate(d).replace(/^\w+, /, "")}
                </text>
              ) : null,
            )}

            {kind === "bar" &&
              colored[0] &&
              colored[0].values.map((v, i) =>
                v == null || v === 0 ? null : (
                  <rect
                    key={i}
                    x={x(i) - barW / 2}
                    y={y(v)}
                    width={barW}
                    height={Math.max(0, y(0) - y(v))}
                    rx={Math.min(4, barW / 2)}
                    fill={colored[0].color}
                    fillOpacity={hover == null || hover === i ? 1 : 0.55}
                  />
                ),
              )}

            {kind === "line" &&
              colored.map((s) => {
                // break the line at missing days
                const segs: string[] = [];
                let cur = "";
                s.values.forEach((v, i) => {
                  if (v == null) {
                    if (cur) segs.push(cur);
                    cur = "";
                  } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
                });
                if (cur) segs.push(cur);
                const lastIdx = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
                return (
                  <g key={s.key}>
                    {segs.map((d, k) => (
                      <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {lastIdx != null && colored.length > 1 && labelY[s.key] != null && (
                      <text x={x(lastIdx) + 6} y={labelY[s.key]! + 3} fontSize={10} fill="currentColor" fillOpacity={0.75}>
                        {s.label}
                      </text>
                    )}
                  </g>
                );
              })}

            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="currentColor" strokeOpacity={0.3} />
                {kind === "line" &&
                  colored.map((s) =>
                    s.values[hover] == null ? null : (
                      <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="white" strokeWidth={2} />
                    ),
                  )}
              </g>
            )}
          </svg>
          {hover != null && (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
            >
              <div className="font-semibold">{fmtDate(dates[hover])}</div>
              {colored.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto pl-2 font-medium tabular-nums">{fmt(s.values[hover])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
