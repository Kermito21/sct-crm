"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Crown, FileText, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@crm/ui/lib/utils";
import { type OnboardingStatus } from "./types";
import { STAGE_LABELS, TIER_COLORS } from "./helpers";

const STAGE_DESCRIPTIONS: Record<OnboardingStatus, string> = {
  invited: "Waiting for client to set password",
  password_set: "Account created, waiting for intake",
  intake_completed: "Intake done, in onboarding",
  active: "Fully onboarded",
};

const STAGE_COLORS: Record<OnboardingStatus, string> = {
  invited: "border-[var(--chart-3)]/30 bg-[var(--chart-3)]/5",
  password_set: "border-sct-cta/30 bg-sct-cta/5",
  intake_completed: "border-purple-500/30 bg-[var(--chart-2)]/5",
  active: "border-sct-heading/30 bg-sct-heading/5",
};

const STAGE_DOT: Record<OnboardingStatus, string> = {
  invited: "bg-[var(--chart-3)]",
  password_set: "bg-sct-cta",
  intake_completed: "bg-[var(--chart-2)]",
  active: "bg-sct-heading",
};

interface PipelineUser {
  id: string;
  name: string | null;
  email: string | null;
  productTier: string;
  onboardingStatus: string;
  isVip: boolean;
  paymentStatus: string | null;
  closerName: string | null;
  phone: string | null;
  source: string;
  createdAt: string;
  intakeCompletedAt: string | null;
  tvUsername: string | null;
  _count: { adminNotes: number };
}

const STAGES: OnboardingStatus[] = ["invited", "password_set", "intake_completed", "active"];

export default function PipelinePanel() {
  const router = useRouter();
  const [byStage, setByStage] = useState<Record<OnboardingStatus, PipelineUser[]>>({
    invited: [],
    password_set: [],
    intake_completed: [],
    active: [],
  });
  const [counts, setCounts] = useState<Record<OnboardingStatus, number>>({
    invited: 0,
    password_set: 0,
    intake_completed: 0,
    active: 0,
  });
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [vipOnly, setVipOnly] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/journal/admin/pipeline");
      if (res.status === 401) { router.push("/admin/login"); return; }
      if (res.ok) {
        const data = await res.json();
        setByStage(data.byStage);
        setCounts(data.counts);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  const advance = async (userId: string, toStatus: OnboardingStatus) => {
    setAdvancingId(userId);
    try {
      const res = await fetch(`/api/journal/admin/pipeline/${userId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus }),
      });
      if (res.ok) {
        fetchPipeline();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to advance: ${err.error || res.statusText}`);
      }
    } finally {
      setAdvancingId(null);
    }
  };

  const filterUsers = (users: PipelineUser[]) => {
    return users.filter(u => {
      if (vipOnly && !u.isVip) return false;
      if (tierFilter !== "all" && u.productTier !== tierFilter) return false;
      return true;
    });
  };

  const totalFiltered = STAGES.reduce((sum, s) => sum + filterUsers(byStage[s]).length, 0);

  return (
    <div className="mx-auto px-3 sm:px-4 lg:px-6 pb-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {STAGES.map(stage => (
          <div key={stage} className={cn("sct-card rounded-xl p-5 border", STAGE_COLORS[stage])}>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("h-2 w-2 rounded-full", STAGE_DOT[stage])} />
              <span className="text-xs font-semibold uppercase tracking-widest text-sct-heading">
                {STAGE_LABELS[stage]}
              </span>
            </div>
            <div className="text-2xl font-semibold text-sct-heading">{counts[stage]}</div>
            <div className="text-xs text-sct-heading/70 mt-0.5">{STAGE_DESCRIPTIONS[stage]}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded-lg border border-sct-surface bg-sct-bg px-3 py-2 text-sm text-sct-heading focus:border-sct-cta/50 focus:outline-none"
        >
          <option value="all">All tiers</option>
          <option value="inner_circle">Inner Circle</option>
          <option value="flex">Flex</option>
          <option value="unlimited">Unlimited</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-sct-heading">
          <input
            type="checkbox"
            checked={vipOnly}
            onChange={(e) => setVipOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          VIP only
        </label>
        <span className="text-sm text-sct-body ml-auto">{totalFiltered} client{totalFiltered !== 1 ? "s" : ""}</span>
        <button
          onClick={fetchPipeline}
          className="flex items-center gap-2 rounded-lg border border-sct-surface px-3 py-2 text-sm font-semibold text-sct-body hover:bg-sct-surface/50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Kanban columns */}
      {loading ? (
        <div className="py-16 text-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {STAGES.map(stage => {
            const users = filterUsers(byStage[stage]);
            return (
              <div key={stage} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-sct-heading flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STAGE_DOT[stage])} />
                    {STAGE_LABELS[stage]}
                  </h3>
                  <span className="text-sm font-semibold text-sct-heading">{users.length}</span>
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {users.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-sct-surface/60 p-4 text-center text-xs text-sct-heading/40">
                      No clients here
                    </div>
                  ) : users.map(user => {
                    const stageIdx = STAGES.indexOf(stage);
                    const nextStageVal = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
                    return (
                      <div
                        key={user.id}
                        className={cn(
                          "sct-card rounded-lg p-4 border",
                          user.isVip ? "border-[var(--chart-3)]/40 bg-[var(--chart-3)]/5" : "border-sct-surface"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              {user.isVip && <Crown size={14} className="text-[var(--chart-3)] flex-shrink-0" />}
                              <p className="text-sm font-semibold text-sct-heading truncate">
                                {user.name || "Unnamed"}
                              </p>
                            </div>
                            <p className="text-sm text-sct-heading truncate">{user.email}</p>
                          </div>
                          <span className={cn("text-xs font-semibold uppercase px-2 py-0.5 rounded border flex-shrink-0", TIER_COLORS[user.productTier] || TIER_COLORS.inner_circle)}>
                            {user.productTier === "inner_circle" ? "IC" : user.productTier === "flex" ? "FX" : "UL"}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2 text-sm font-semibold text-sct-heading flex-wrap">
                          {user.source === "fanbasis" && (
                            <span className="px-1.5 py-0.5 rounded bg-sct-heading/15 text-sct-heading font-semibold uppercase tracking-wider">
                              FanBasis
                            </span>
                          )}
                          {user.closerName && <span>by {user.closerName}</span>}
                          {user.paymentStatus && (
                            <span className={cn(
                              "px-1.5 py-0.5 rounded",
                              user.paymentStatus === "paid" ? "bg-sct-heading/15 text-sct-heading" :
                              user.paymentStatus === "refunded" ? "bg-sct-body/15 text-sct-body" :
                              "bg-[var(--chart-3)]/15 text-[var(--chart-3)]"
                            )}>
                              {user.paymentStatus}
                            </span>
                          )}
                          {user._count.adminNotes > 0 && (
                            <span className="ml-auto flex items-center gap-1 text-[var(--chart-3)]">
                              <FileText size={9} /> {user._count.adminNotes}
                            </span>
                          )}
                        </div>
                        {nextStageVal && (
                          <button
                            onClick={() => advance(user.id, nextStageVal)}
                            disabled={advancingId === user.id}
                            className="mt-2 w-full flex items-center justify-center gap-1 rounded-md border border-sct-cta/30 bg-sct-cta/5 px-2 py-1 text-xs font-semibold text-sct-cta hover:bg-sct-cta/10 transition-colors disabled:opacity-50"
                          >
                            {advancingId === user.id ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <>Advance to {STAGE_LABELS[nextStageVal]} <ArrowRight size={9} /></>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
