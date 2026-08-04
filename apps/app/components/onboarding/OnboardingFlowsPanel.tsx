"use client";

// Onboarding Flows — admin dashboard tab.
//
// Single home for organic onboarding: visual funnel analytics (animated
// stat cards + sparkline, radial conversion gauge, source donut, trend) AND
// the merged lead-triage table with a slide-in detail drawer. Channel-
// parameterised so the Scaled partner view is a one-flag copy later.
//
// Data: GET /api/journal/admin/onboarding. Styling: SCT cool-white theme. All motion
// is CSS / requestAnimationFrame — no framer-motion (kept off Android).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  RefreshCw,
  Users,
  PhoneCall,
  BadgeCheck,
  Activity,
  TrendingUp,
  Megaphone,
  Sprout,
  Search,
  StickyNote,
  CalendarClock,
} from "lucide-react";
import { cn } from "@crm/ui/lib/utils";
import LeadDetailDrawer from "./LeadDetailDrawer";

type Channel = "organic" | "scaled";
type ProductFilter = "all" | "unlimited" | "flex";

interface FunnelStageRow {
  key: string;
  label: string;
  description: string;
  count: number;
  pctOfTotal: number;
  conversionFromPrev: number;
}
interface FunnelSummary {
  product: "unlimited" | "flex";
  stages: FunnelStageRow[];
  total: number;
  lost: number;
}
interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  product: string;
  status: string;
  utmSource: string | null;
  createdAt: string;
  stageKey: string;
  stageLabel: string;
  stageIndex: number;
  isLost: boolean;
  converted: boolean;
  callBookedAt: string | null;
  hasNote: boolean;
}
interface OnboardingData {
  channel: string;
  product: string;
  funnels: FunnelSummary[];
  cards: {
    totalLeads: number;
    contacted: number;
    clients: number;
    active: number;
    conversionPct: number;
    lost: number;
    leadsDeltaPct: number | null;
  };
  sources: Record<string, number>;
  sourceConversion: { source: string; leads: number; clients: number; conversionPct: number }[];
  stuck: {
    id: string;
    name: string | null;
    email: string | null;
    product: string;
    status: string;
    stageLabel: string;
    daysIdle: number;
  }[];
  velocity: {
    avgDaysToReview: number | null;
    reviewSample: number;
    avgDaysToActive: number | null;
    activeSample: number;
  };
  kpis: { leadsToday: number; leadsThisWeek: number; leadsThisMonth: number; clientsThisMonth: number };
  productSplit: { product: string; leads: number; clients: number }[];
  trend: { date: string; count: number }[];
  heatmap: { grid: number[][]; max: number; days: string[]; buckets: string[] };
  leads: Lead[];
}

// Brand-derived palette (tints of CTA blue + charcoal accent) — no off-brand hues.
const DONUT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)", "var(--chart-1)", "var(--chart-1)", "var(--chart-3)"];

// Shared, theme-aware tooltip styling with explicit readable text colors
// (the default item color inherits the series colour, which goes low-contrast
// on the dark surface).
const TOOLTIP_CONTENT = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
} as const;
const TOOLTIP_ITEM = { color: "var(--foreground)" } as const;
const TOOLTIP_LABEL = { color: "var(--muted-foreground)", fontWeight: 600 } as const;

function useTickColor() {
  const [color, setColor] = useState("var(--muted-foreground)");
  useEffect(() => {
    const c = getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim();
    if (c) setColor(c);
  }, []);
  return color;
}

// Ease-out count-up for the headline numbers.
function useCountUp(target: number, duration = 700) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      setVal(next);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function sourceLabel(s: string | null | undefined): string {
  if (!s) return "Direct";
  const known: Record<string, string> = {
    instagram: "Instagram", google: "Google", discord: "Discord", telegram: "Telegram",
    youtube: "YouTube", twitter: "Twitter / X", x: "Twitter / X", facebook: "Facebook",
    tiktok: "TikTok", reddit: "Reddit", email: "Email", newsletter: "Newsletter", direct: "Direct",
  };
  return known[s.toLowerCase()] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

const PRODUCT_LABEL: Record<string, string> = { unlimited: "Unlimited", flex: "Flex" };
const shareOf = (n?: number, total?: number) => (total && total > 0 ? (n ?? 0) / total : null);

function initials(name: string | null, email: string | null): string {
  const base = (name || email || "?").trim();
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Build a continuous day-by-day series (filling gaps with 0) ending today,
// so the bar chart has no missing columns. Keys match the API (UTC date).
function buildDailySeries(trend: { date: string; count: number }[], days: number) {
  const map = new Map(trend.map((t) => [t.date, t.count]));
  const out: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

export default function OnboardingFlowsPanel() {
  const router = useRouter();
  const tickColor = useTickColor();
  const [channel, setChannel] = useState<Channel>("organic");
  const [product, setProduct] = useState<ProductFilter>("all");
  const [data, setData] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leads table filters + drawer
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<14 | 30 | 90>(30);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal/admin/onboarding?channel=${channel}&product=${product}`);
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [channel, product, router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedSources = useMemo(
    () =>
      Object.entries(data?.sources ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [data]
  );
  const donutData = useMemo(
    () => sortedSources.map(([key, value]) => ({ name: sourceLabel(key), value })),
    [sortedSources]
  );

  const stageOptions = useMemo(() => {
    const seen: string[] = [];
    for (const l of data?.leads ?? []) {
      if (!l.isLost && !seen.includes(l.stageLabel)) seen.push(l.stageLabel);
    }
    return seen;
  }, [data]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.leads ?? []).filter((l) => {
      if (stageFilter === "lost" && !l.isLost) return false;
      if (stageFilter !== "all" && stageFilter !== "lost" && l.stageLabel !== stageFilter) return false;
      if (!q) return true;
      return (
        (l.name ?? "").toLowerCase().includes(q) || (l.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, stageFilter]);

  const isEmptyScaled = channel === "scaled" && (data?.cards.totalLeads ?? 0) === 0;
  const daily90 = useMemo(() => buildDailySeries(data?.trend ?? [], 90), [data]);
  const trendSeries = useMemo(() => daily90.slice(-trendRange), [daily90, trendRange]);
  const trendTotal = useMemo(() => trendSeries.reduce((a, d) => a + d.count, 0), [trendSeries]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-sct-heading">Onboarding Flows</h1>
        <p className="text-sm text-sct-body mt-1 max-w-3xl">
          Track every applicant from first form submission to fully-onboarded client, and review each
          lead in place. Switch channels to keep organic leads separate from marketing-partner (Scaled) leads.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-sct-surface p-1 bg-sct-bg">
            {(["organic", "scaled"] as Channel[]).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  channel === c ? "bg-sct-cta text-primary-foreground" : "text-sct-body hover:bg-sct-surface/50"
                )}
              >
                {c === "organic" ? <Sprout size={14} /> : <Megaphone size={14} />}
                {c === "organic" ? "Organic" : "Scaled"}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-sct-surface p-1 bg-sct-bg">
            {(["all", "unlimited", "flex"] as ProductFilter[]).map((p) => (
              <button
                key={p}
                onClick={() => setProduct(p)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  product === p ? "bg-sct-accent text-primary-foreground" : "text-sct-body hover:bg-sct-surface/50"
                )}
              >
                {p === "all" ? "All" : PRODUCT_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-sct-surface px-3 py-2 text-sm font-semibold text-sct-body hover:bg-sct-surface/50 transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div
          className="mb-4 text-xs px-3 py-2 rounded"
          style={{ color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          {error}
        </div>
      )}

      {isEmptyScaled ? (
        <div className="sct-card rounded-xl p-12 text-center">
          <Megaphone className="h-10 w-10 text-sct-body/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-sct-heading">Scaled channel — no data yet</h3>
          <p className="text-sm text-sct-body mt-1 max-w-md mx-auto">
            This view lights up once the Scaled partner&apos;s VSL intake starts sending leads. The same
            funnel will track their numbers here so they can be verified against what&apos;s reported.
          </p>
        </div>
      ) : (
        <>
          {/* KPI strip — recent activity at a glance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KpiPill label="Leads today" value={data?.kpis.leadsToday ?? 0} />
            <KpiPill label="Leads this week" value={data?.kpis.leadsThisWeek ?? 0} />
            <KpiPill label="Leads this month" value={data?.kpis.leadsThisMonth ?? 0} />
            <KpiPill label="New clients (mo)" value={data?.kpis.clientsThisMonth ?? 0} accent />
          </div>

          {/* Stat cards — animated; Total Leads gets a bar sparkline + delta,
              the funnel-stage cards get a share-of-total bar. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
            <StatCard icon={<Users size={15} />} label="Total Leads" value={data?.cards.totalLeads ?? 0} spark={daily90} delta={data?.cards.leadsDeltaPct ?? null} />
            <StatCard icon={<PhoneCall size={15} />} label="Contacted" value={data?.cards.contacted ?? 0} share={shareOf(data?.cards.contacted, data?.cards.totalLeads)} />
            <StatCard icon={<BadgeCheck size={15} />} label="Clients" value={data?.cards.clients ?? 0} share={shareOf(data?.cards.clients, data?.cards.totalLeads)} />
            <StatCard icon={<Activity size={15} />} label="Active" value={data?.cards.active ?? 0} share={shareOf(data?.cards.active, data?.cards.totalLeads)} />
            <StatCard
              icon={<TrendingUp size={15} />}
              label="Conversion"
              value={data?.cards.conversionPct ?? 0}
              isPercent
              sub={`${data?.cards.lost ?? 0} lost`}
            />
          </div>

          {/* Funnels (wide) + gauge & donut (rail) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            <div className="lg:col-span-2 space-y-5">
              {(data?.funnels ?? []).map((f) => (
                <SankeyFunnel key={f.product} funnel={f} />
              ))}
            </div>
            <div className="space-y-5">
              <ConversionGauge value={data?.cards.conversionPct ?? 0} active={data?.cards.active ?? 0} total={data?.cards.totalLeads ?? 0} />
              <SourceDonut data={donutData} />
            </div>
          </div>

          {/* Trend — ranged bar chart */}
          <div className="sct-card rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <div className="text-2xl font-light text-sct-heading tabular-nums">{trendTotal.toLocaleString()}</div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-sct-body">
                  Leads — last {trendRange} days
                </h3>
              </div>
              <div className="inline-flex rounded-lg border border-sct-surface p-0.5 bg-sct-bg">
                {([14, 30, 90] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTrendRange(r)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                      trendRange === r ? "bg-sct-cta text-primary-foreground" : "text-sct-body hover:bg-sct-surface/50"
                    )}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            </div>
            {trendTotal === 0 ? (
              <p className="text-sm text-sct-body py-12 text-center">No leads in the last {trendRange} days.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendSeries} margin={{ top: 5, right: 8, left: -12, bottom: 0 }} barCategoryGap={trendRange > 30 ? 1 : 2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={`${tickColor}20`} />
                  <XAxis
                    dataKey="date"
                    stroke={tickColor}
                    style={{ fontSize: "11px" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis stroke={tickColor} style={{ fontSize: "11px" }} allowDecimals={false} width={28} />
                  <Tooltip
                    cursor={{ fill: `${tickColor}10` }}
                    contentStyle={TOOLTIP_CONTENT}
                    itemStyle={TOOLTIP_ITEM}
                    labelStyle={TOOLTIP_LABEL}
                  />
                  <Bar dataKey="count" name="Leads" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Conversion by source (wide) + velocity & product split (rail) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            <div className="lg:col-span-2">
              <ConversionBySource rows={data?.sourceConversion ?? []} />
            </div>
            <div className="space-y-5">
              <VelocityCard velocity={data?.velocity} />
              <ProductSplitCard rows={data?.productSplit ?? []} />
            </div>
          </div>

          {/* Leads-by-time heatmap */}
          {data?.heatmap && <Heatmap heatmap={data.heatmap} />}

          {/* Stuck / aging leads */}
          {(data?.stuck.length ?? 0) > 0 && (
            <StuckLeads rows={data?.stuck ?? []} onOpen={setOpenLeadId} />
          )}

          {/* Leads table (merged triage) */}
          <div className="sct-card rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-sct-bg border-b border-sct-surface flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading">
                Leads <span className="text-sct-body font-normal">({filteredLeads.length})</span>
              </h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sct-body/60" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or email"
                    className="h-9 w-48 rounded-lg border border-sct-surface bg-sct-bg pl-8 pr-3 text-sm text-sct-heading outline-none focus:border-sct-cta placeholder:text-sct-body/50"
                  />
                </div>
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="h-9 rounded-lg border border-sct-surface bg-sct-bg px-2 text-sm text-sct-heading outline-none focus:border-sct-cta"
                >
                  <option value="all">All stages</option>
                  {stageOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="lost">Lost</option>
                </select>
              </div>
            </div>

            {filteredLeads.length === 0 ? (
              <p className="text-sm text-sct-body py-12 text-center">No leads match.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-sct-body border-b border-sct-surface">
                      <th className="px-5 py-2.5">Lead</th>
                      <th className="px-3 py-2.5">Product</th>
                      <th className="px-3 py-2.5">Stage</th>
                      <th className="px-3 py-2.5">Source</th>
                      <th className="px-3 py-2.5">Call</th>
                      <th className="px-3 py-2.5">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((l) => (
                      <tr
                        key={l.id}
                        onClick={() => setOpenLeadId(l.id)}
                        className="border-b border-sct-surface/60 cursor-pointer hover:bg-sct-surface/30 transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sct-cta/12 text-[11px] font-bold text-sct-cta">
                              {initials(l.name, l.email)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-sct-heading truncate max-w-[180px]">
                                  {l.name || l.email || "Unknown"}
                                </span>
                                {l.hasNote && (
                                  <StickyNote size={12} className="shrink-0 text-sct-cta" aria-label="Has notes" />
                                )}
                              </div>
                              <div className="text-[11px] text-sct-body truncate max-w-[200px]">
                                {l.email || "no email"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs font-semibold text-sct-body">
                            {PRODUCT_LABEL[l.product] ?? l.product}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-tag inline-block"
                            style={
                              l.isLost
                                ? { background: "rgba(239,68,68,0.1)", color: "rgba(239,68,68,0.9)" }
                                : { background: "color-mix(in srgb, var(--chart-2) 12%, transparent)", color: "var(--chart-2)" }
                            }
                          >
                            {l.isLost ? "Lost" : l.stageLabel}
                          </span>
                          {l.converted && !l.isLost && (
                            <span className="ml-1.5 text-[10px] font-semibold text-sct-body">• client</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-sct-body">{sourceLabel(l.utmSource)}</td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">
                          {l.callBookedAt ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-sct-cta">
                              <CalendarClock size={12} />
                              {new Date(l.callBookedAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          ) : (
                            <span className="text-sct-body/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-sct-body whitespace-nowrap">
                          {new Date(l.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <LeadDetailDrawer leadId={openLeadId} onClose={() => setOpenLeadId(null)} onChanged={reload} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  isPercent,
  spark,
  delta,
  share,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  isPercent?: boolean;
  spark?: { date: string; count: number }[];
  delta?: number | null;
  share?: number | null;
}) {
  const animated = useCountUp(isPercent ? value * 100 : value);
  const display = isPercent ? `${Math.round(animated)}%` : Math.round(animated).toLocaleString();
  const showDelta = delta !== null && delta !== undefined;
  const up = (delta ?? 0) >= 0;
  const sparkBars = (spark ?? []).slice(-14);
  return (
    <div className="group relative sct-card rounded-xl p-4 overflow-hidden transition-transform duration-200 hover:-translate-y-0.5">
      {/* top accent line */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-sct-cta to-transparent opacity-60" />
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-sct-body">
        <span className="text-sct-cta">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-light text-sct-heading mt-1.5 tabular-nums">{display}</div>
      {showDelta && (
        <div
          className="text-[11px] font-semibold mt-0.5"
          style={{ color: up ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.9)" }}
        >
          {up ? "▲" : "▼"} {Math.abs(Math.round((delta ?? 0) * 100))}% vs prior 30d
        </div>
      )}
      {sub && <div className="text-xs font-light text-sct-body mt-0.5">{sub}</div>}
      {sparkBars.length > 1 && (
        <div className="mt-2 -mx-0.5 h-9">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sparkBars} margin={{ top: 2, right: 0, left: 0, bottom: 0 }} barCategoryGap={1}>
              <Bar dataKey="count" fill="var(--chart-2)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {share !== null && share !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-sct-surface overflow-hidden">
            <div
              className="h-full rounded-full bg-sct-cta transition-all duration-500"
              style={{ width: `${Math.max(share * 100, 2)}%` }}
            />
          </div>
          <div className="text-[10px] text-sct-body mt-1">{Math.round(share * 100)}% of leads</div>
        </div>
      )}
    </div>
  );
}

function ConversionGauge({ value, active, total }: { value: number; active: number; total: number }) {
  const animated = useCountUp(value * 100);
  const gauge = [{ name: "conversion", value: Math.min(value * 100, 100), fill: "var(--chart-2)" }];
  return (
    <div className="sct-card rounded-xl p-5">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading mb-2">Conversion</h3>
      <div className="relative">
        <ResponsiveContainer width="100%" height={170}>
          <RadialBarChart innerRadius="72%" outerRadius="100%" data={gauge} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: "var(--card)" }} dataKey="value" cornerRadius={12} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-3xl font-light text-sct-heading tabular-nums">{Math.round(animated)}%</span>
          <span className="text-[11px] text-sct-body mt-0.5">{active} of {total}</span>
        </div>
      </div>
      <p className="text-xs text-sct-body text-center mt-1">Leads that reached the final stage</p>
    </div>
  );
}

function SourceDonut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const [active, setActive] = useState<number | null>(null);
  const cur = active !== null ? data[active] : null;
  const centerTop = cur ? `${total > 0 ? Math.round((cur.value / total) * 100) : 0}%` : String(total);
  const centerBottom = cur ? cur.name : "leads";
  return (
    <div className="sct-card rounded-xl p-5">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading mb-2">Leads by source</h3>
      {data.length === 0 ? (
        <p className="text-sm text-sct-body py-8 text-center">No attributed leads yet.</p>
      ) : (
        <div className="flex items-center gap-4">
          {/* Interactive donut: hover a slice to surface its share in the
              centre and highlight its legend row. No overlapping tooltip. */}
          <div className="relative w-[132px] h-[132px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={44}
                  outerRadius={62}
                  paddingAngle={data.length > 1 ? 2 : 0}
                  stroke="none"
                  onMouseLeave={() => setActive(null)}
                  isAnimationActive={false}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                      opacity={active === null || active === i ? 1 : 0.4}
                      onMouseEnter={() => setActive(i)}
                      style={{ transition: "opacity 150ms", cursor: "pointer" }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
              <span className="text-2xl font-light text-sct-heading tabular-nums leading-none">{centerTop}</span>
              <span className="text-[10px] text-sct-body mt-0.5 truncate max-w-full">{centerBottom}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {data.slice(0, 6).map((d, i) => {
              const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
              return (
                <div
                  key={d.name}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  className={cn(
                    "flex items-center gap-2 text-xs rounded-md px-1.5 py-1 -mx-1.5 cursor-default transition-colors",
                    active === i ? "bg-sct-surface/60" : ""
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="text-sct-heading truncate flex-1">{d.name}</span>
                  <span className="text-sct-body tabular-nums">
                    <span className="font-semibold text-sct-heading">{share}%</span> · {d.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Build the filled ribbon path for the flowing funnel: smooth top edge
// left→right through each node, down the right side, smooth bottom edge back.
function buildFunnelPath(
  topPts: { x: number; y: number }[],
  botPts: { x: number; y: number }[]
): string {
  const N = topPts.length;
  const first = topPts[0];
  const lastBot = botPts[N - 1];
  if (!first || !lastBot) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < N; i++) {
    const a = topPts[i - 1];
    const b = topPts[i];
    if (!a || !b) continue;
    const cx = (a.x + b.x) / 2;
    d += ` C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
  }
  d += ` L ${lastBot.x} ${lastBot.y}`;
  for (let i = N - 1; i > 0; i--) {
    const a = botPts[i];
    const b = botPts[i - 1];
    if (!a || !b) continue;
    const cx = (a.x + b.x) / 2;
    d += ` C ${cx} ${a.y}, ${cx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d + " Z";
}

// Flowing horizontal funnel (efferd dashboard-9 style): a continuous ribbon
// whose thickness at each stage is proportional to that stage's count, with
// the count on top, a cumulative-% pill in the middle, and the label below.
function SankeyFunnel({ funnel }: { funnel: FunnelSummary }) {
  const stages = funnel.stages;
  const N = stages.length;
  const VB_W = 1000;
  const VB_H = 100;
  const top = 14;
  const bottom = 86;
  const mid = (top + bottom) / 2;
  const bandH = bottom - top;
  const maxCount = stages[0]?.count ?? 0;
  const colW = VB_W / N;
  // node centres, plus flat segments at the far left/right edges
  const nodeXs = stages.map((_, i) => colW * (i + 0.5));
  const halves = stages.map((s) => (Math.max(maxCount > 0 ? s.count / maxCount : 0, 0.015) * bandH) / 2);
  const xs = [0, ...nodeXs, VB_W];
  const hs = [halves[0] ?? 0, ...halves, halves[N - 1] ?? 0];
  const topPts = xs.map((x, i) => ({ x, y: mid - (hs[i] ?? 0) }));
  const botPts = xs.map((x, i) => ({ x, y: mid + (hs[i] ?? 0) }));
  const path = buildFunnelPath(topPts, botPts);
  const gid = `funnel-grad-${funnel.product}`;

  return (
    <div className="sct-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading">
          {PRODUCT_LABEL[funnel.product]} Funnel
        </h3>
        <div className="text-xs text-sct-body">
          <span className="font-semibold text-sct-heading">{funnel.total}</span> in funnel
          {funnel.lost > 0 && <span> · {funnel.lost} lost</span>}
        </div>
      </div>
      <div className="relative w-full h-[240px]">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0.28" />
            </linearGradient>
          </defs>
          <path d={path} fill={`url(#${gid})`} />
        </svg>
        {/* Column overlay: count (top), cumulative-% pill (centre), label (bottom) */}
        <div className="absolute inset-0 flex">
          {stages.map((s, i) => (
            <div
              key={s.key}
              className={cn(
                "flex-1 flex flex-col items-center justify-between py-3 px-1 min-w-0",
                i > 0 && "border-l border-sct-surface/70"
              )}
            >
              <div className="text-base font-semibold text-sct-heading tabular-nums">{s.count}</div>
              <div className="rounded-full bg-sct-bg/85 border border-sct-surface px-2.5 py-0.5 text-xs font-bold text-sct-heading tabular-nums shadow-sm">
                {Math.round(s.pctOfTotal * 100)}%
              </div>
              <div className="text-[11px] text-sct-body text-center leading-tight line-clamp-2">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const animated = useCountUp(value);
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        accent ? "border-sct-cta/30 bg-sct-cta/5" : "border-sct-surface bg-sct-bg"
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-sct-body">{label}</div>
      <div
        className={cn(
          "text-xl font-light tabular-nums mt-0.5",
          accent ? "text-sct-cta" : "text-sct-heading"
        )}
      >
        {Math.round(animated).toLocaleString()}
      </div>
    </div>
  );
}

function ConversionBySource({
  rows,
}: {
  rows: { source: string; leads: number; clients: number; conversionPct: number }[];
}) {
  return (
    <div className="sct-card rounded-xl p-5 h-full">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading">Conversion by source</h3>
      <p className="text-xs text-sct-body mb-4">Lead → client rate per channel — where to spend</p>
      {rows.length === 0 ? (
        <p className="text-sm text-sct-body py-10 text-center">No attributed leads yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const w = Math.round(r.conversionPct * 100);
            return (
              <div key={r.source}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-sct-heading">{sourceLabel(r.source)}</span>
                  <span className="text-sct-body">
                    {r.clients}/{r.leads} <span className="font-bold text-sct-heading">{w}%</span>
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-sct-surface overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sct-cta transition-all duration-500"
                    style={{ width: `${Math.max(w, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VelocityCard({
  velocity,
}: {
  velocity?: {
    avgDaysToReview: number | null;
    reviewSample: number;
    avgDaysToActive: number | null;
    activeSample: number;
  };
}) {
  const row = (label: string, value: number | null | undefined, sample: number) => (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-sct-body">{label}</span>
        <span className="text-lg font-light text-sct-heading tabular-nums">
          {value === null || value === undefined ? "—" : `${value}d`}
        </span>
      </div>
      <div className="text-[10px] text-sct-body">{sample > 0 ? `${sample} sampled` : "no data yet"}</div>
    </div>
  );
  return (
    <div className="sct-card rounded-xl p-5">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading mb-3">Velocity</h3>
      <div className="space-y-3">
        {row("Lead → first response", velocity?.avgDaysToReview, velocity?.reviewSample ?? 0)}
        {row("Lead → active client", velocity?.avgDaysToActive, velocity?.activeSample ?? 0)}
      </div>
      <p className="text-[10px] text-sct-body italic mt-3">Approximate, from available timestamps.</p>
    </div>
  );
}

function ProductSplitCard({ rows }: { rows: { product: string; leads: number; clients: number }[] }) {
  const totalLeads = rows.reduce((a, r) => a + r.leads, 0);
  return (
    <div className="sct-card rounded-xl p-5">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading mb-3">Product split</h3>
      {rows.length === 0 || totalLeads === 0 ? (
        <p className="text-sm text-sct-body py-6 text-center">No leads yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const share = totalLeads > 0 ? r.leads / totalLeads : 0;
            return (
              <div key={r.product}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-sct-heading">{PRODUCT_LABEL[r.product] ?? r.product}</span>
                  <span className="text-sct-body text-xs">
                    {r.leads} leads · {r.clients} clients
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-sct-surface overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sct-accent transition-all duration-500"
                    style={{ width: `${Math.max(share * 100, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StuckLeads({
  rows,
  onOpen,
}: {
  rows: { id: string; name: string | null; email: string | null; product: string; status: string; stageLabel: string; daysIdle: number }[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="sct-card rounded-xl overflow-hidden mb-6">
      <div className="px-5 py-3 bg-sct-bg border-b border-sct-surface flex items-center justify-between">
        <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading">
          Needs follow-up <span className="text-sct-body font-normal">({rows.length})</span>
        </h3>
        <span className="text-xs text-sct-body">Idle 7+ days, not yet a client</span>
      </div>
      <div>
        {rows.map((r) => {
          const urgent = r.daysIdle >= 14;
          return (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="w-full text-left flex items-center justify-between gap-3 px-5 py-3 border-b border-sct-surface/60 hover:bg-sct-surface/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-semibold text-sct-heading truncate max-w-[260px]">
                  {r.name || r.email || "Unknown"}
                </div>
                <div className="text-[11px] text-sct-body truncate">
                  {PRODUCT_LABEL[r.product] ?? r.product} · {r.stageLabel}
                </div>
              </div>
              <span
                className="text-xs font-bold px-2 py-1 rounded-tag whitespace-nowrap"
                style={
                  urgent
                    ? { background: "rgba(239,68,68,0.12)", color: "rgba(239,68,68,0.9)" }
                    : { background: "rgba(234,179,8,0.14)", color: "var(--chart-3)" }
                }
              >
                {r.daysIdle}d idle
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Heatmap({
  heatmap,
}: {
  heatmap: { grid: number[][]; max: number; days: string[]; buckets: string[] };
}) {
  const { grid, max, days, buckets } = heatmap;
  return (
    <div className="sct-card rounded-xl p-5 mb-6">
      <h3 className="text-base font-bold uppercase tracking-wide text-sct-heading">Leads by day &amp; time</h3>
      <p className="text-xs text-sct-body mb-4">When leads come in — all-time, your local time</p>
      <div className="overflow-x-auto">
        <div className="min-w-[420px] space-y-1">
          {/* Header row of time buckets */}
          <div className="flex items-center gap-1">
            <div className="w-10 shrink-0" />
            {buckets.map((b) => (
              <div key={b} className="flex-1 text-[10px] text-sct-body text-center">
                {b}
              </div>
            ))}
          </div>
          {days.map((day, r) => (
            <div key={day} className="flex items-center gap-1">
              <div className="w-10 shrink-0 text-[11px] font-semibold text-sct-body">{day}</div>
              {(grid[r] ?? []).map((v, c) => {
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={c}
                    title={`${day} ${buckets[c]} — ${v} lead${v === 1 ? "" : "s"}`}
                    className="flex-1 h-7 rounded-[3px] transition-colors"
                    style={{
                      background: v === 0 ? "var(--card)" : `color-mix(in srgb, var(--chart-2) ${Math.round((0.18 + intensity * 0.82) * 100)}%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-sct-body">
        <span>Fewer</span>
        {[0.18, 0.4, 0.6, 0.8, 1].map((o) => (
          <span key={o} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `color-mix(in srgb, var(--chart-2) ${Math.round(o * 100)}%, transparent)` }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
