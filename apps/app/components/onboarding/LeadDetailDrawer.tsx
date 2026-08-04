"use client";

// Lead detail drawer — the application triage UI (status, attribution,
// payload, email reply, internal notes, delete) pulled into the Onboarding
// Flows tab so leads can be reviewed without leaving the dashboard. Slides
// in from the right; CSS-only animation (no framer-motion). Reuses the
// existing /api/journal/admin/applications/[id] endpoints, so it works for both
// Unlimited and Flex rows.
import { useEffect, useState } from "react";
import {
  X,
  Mail,
  Check,
  Clock,
  Loader2,
  Send,
  Trash2,
  MessageSquare,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@crm/ui/lib/utils";

type Status = "pending" | "contacted" | "approved" | "rejected";

const STATUS_META: Record<Status, { label: string; bg: string; fg: string }> = {
  pending: { label: "Pending", bg: "rgba(99,102,241,0.15)", fg: "rgba(99,102,241,0.9)" },
  contacted: { label: "Contacted", bg: "rgba(77,104,235,0.15)", fg: "#4c9eff" },
  approved: { label: "Approved", bg: "rgba(34,197,94,0.15)", fg: "rgba(34,197,94,0.9)" },
  rejected: { label: "Rejected", bg: "rgba(239,68,68,0.15)", fg: "rgba(239,68,68,0.9)" },
};

interface ApplicationDetail {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: Status;
  product: string;
  channel: string;
  payload: Record<string, unknown>;
  adminNotes: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referer: string | null;
  callBookedAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  lastEmailedAt: string | null;
}

function humaniseKey(k: string): string {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
function renderPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ISO -> value for <input type="datetime-local"> in the admin's local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadDetailDrawer({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [callInput, setCallInput] = useState("");
  const [savingCall, setSavingCall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReplyOpen(false);
    (async () => {
      try {
        const res = await fetch(`/api/journal/admin/applications/${leadId}`);
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        setDetail(data.application);
        setNotesDraft(data.application.adminNotes ?? "");
        setCallInput(toLocalInput(data.application.callBookedAt ?? null));
        setReplySubject(
          `Your SCT application${data.application.name ? `, ${data.application.name}` : ""}`
        );
        setReplyBody("");
        // Opening clears this admin's unread badge — let the shell know.
        window.dispatchEvent(new CustomEvent("admin:badges-changed"));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const updateStatus = async (status: Status) => {
    if (!detail) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/journal/admin/applications/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      setDetail((d) => (d ? { ...d, ...data.application } : d));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setStatusBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/journal/admin/applications/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNotes: notesDraft }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      setDetail((d) => (d ? { ...d, ...data.application } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingNotes(false);
    }
  };

  const sendReply = async () => {
    if (!detail || !replySubject.trim() || !replyBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/journal/admin/applications/${detail.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: replySubject, body: replyBody }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Send failed (${res.status})`);
      }
      const data = await res.json();
      setDetail((d) => (d ? { ...d, ...data.application } : d));
      setReplyBody("");
      setReplyOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const saveCall = async (clear = false) => {
    if (!detail) return;
    setSavingCall(true);
    try {
      const iso = clear || !callInput ? null : new Date(callInput).toISOString();
      const res = await fetch(`/api/journal/admin/applications/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callBookedAt: iso }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      setDetail((d) => (d ? { ...d, ...data.application } : d));
      setCallInput(toLocalInput(data.application.callBookedAt ?? null));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingCall(false);
    }
  };

  const deleteApplication = async () => {
    if (!detail) return;
    if (!confirm("Delete this lead permanently? Spam only — reject legitimate leads instead.")) return;
    try {
      const res = await fetch(`/api/journal/admin/applications/${detail.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const open = !!leadId;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      {/* Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full max-w-[460px] bg-sct-bg border-l border-sct-surface shadow-2xl transition-transform duration-300 overflow-y-auto",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-sct-surface sticky top-0 bg-sct-bg z-10">
          <h2 className="text-sm font-bold uppercase tracking-wide text-sct-heading">Lead detail</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-sct-body hover:bg-sct-surface/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-sct-cta" />
          </div>
        )}

        {!loading && !detail && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="h-10 w-10 text-sct-body/40 mb-3" />
            <p className="text-sm text-sct-body">{error ?? "Select a lead"}</p>
          </div>
        )}

        {!loading && detail && (
          <div className="p-5 space-y-5">
            {error && (
              <div
                className="text-xs px-3 py-2 rounded"
                style={{ color: "rgba(239,68,68,0.9)", background: "rgba(239,68,68,0.08)" }}
              >
                {error}
              </div>
            )}

            {/* Identity */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-sct-heading truncate">
                  {detail.name || "Unknown lead"}
                </h3>
                <div className="text-sm text-sct-body break-all">{detail.email || "no email"}</div>
                {detail.phone && <div className="text-xs text-sct-cta mt-0.5">{detail.phone}</div>}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-tag bg-sct-surface text-sct-body">
                    {detail.product}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-tag bg-sct-surface text-sct-body">
                    {detail.channel}
                  </span>
                </div>
              </div>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: STATUS_META[detail.status].bg, color: STATUS_META[detail.status].fg }}
              >
                {STATUS_META[detail.status].label}
              </span>
            </div>

            {/* Status actions */}
            <div className="grid grid-cols-2 gap-2">
              {(["pending", "contacted", "approved", "rejected"] as Status[]).map((s) => (
                <button
                  key={s}
                  onClick={() => updateStatus(s)}
                  disabled={statusBusy || detail.status === s}
                  className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 transition-colors"
                  style={{ background: STATUS_META[s].bg, color: STATUS_META[s].fg }}
                >
                  {s === "approved" ? <Check size={12} /> : s === "contacted" ? <Mail size={12} /> : <Clock size={12} />}
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>

            {/* Call booking */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-sct-heading mb-2">
                Call booking
              </h4>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={callInput}
                  onChange={(e) => setCallInput(e.target.value)}
                  className="flex-1 rounded-lg border border-sct-surface px-3 py-2 text-sm text-sct-heading bg-sct-bg outline-none focus:border-sct-cta"
                />
                <button
                  onClick={() => saveCall(false)}
                  disabled={savingCall || !callInput || toLocalInput(detail.callBookedAt) === callInput}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-white bg-sct-cta disabled:opacity-40"
                >
                  {savingCall ? "..." : "Save"}
                </button>
                {detail.callBookedAt && (
                  <button
                    onClick={() => saveCall(true)}
                    disabled={savingCall}
                    className="rounded-lg px-3 py-2 text-xs font-semibold text-sct-body border border-sct-surface hover:bg-sct-surface/50"
                  >
                    Clear
                  </button>
                )}
              </div>
              {detail.callBookedAt && (
                <p className="text-xs text-sct-cta font-semibold mt-1.5">
                  Booked for {format(new Date(detail.callBookedAt), "EEE MMM d, h:mm a")}
                </p>
              )}
            </div>

            {/* Reply */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-sct-heading mb-2">
                Reply by email
              </h4>
              {!replyOpen ? (
                <button
                  onClick={() => setReplyOpen(true)}
                  disabled={!detail.email}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-sct-cta hover:bg-sct-cta-hover disabled:opacity-40 transition-colors"
                >
                  <Mail size={13} /> {detail.email ? "Compose reply" : "No email on file"}
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    placeholder="Subject"
                    className="w-full rounded-lg border border-sct-surface px-3 py-2 text-sm text-sct-heading bg-sct-bg outline-none focus:border-sct-cta"
                  />
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={6}
                    placeholder="Write your reply..."
                    className="w-full rounded-lg border border-sct-surface px-3 py-2 text-sm text-sct-heading bg-sct-bg outline-none focus:border-sct-cta resize-y"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setReplyOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-sct-body">
                      Cancel
                    </button>
                    <button
                      onClick={sendReply}
                      disabled={sending || !replySubject.trim() || !replyBody.trim()}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-sct-cta disabled:opacity-40"
                    >
                      {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              )}
              {detail.lastEmailedAt && (
                <p className="text-[10px] text-sct-body italic mt-1">
                  Last sent {format(new Date(detail.lastEmailedAt), "MMM d, HH:mm")}
                </p>
              )}
            </div>

            {/* Attribution */}
            {(detail.utmSource || detail.utmMedium || detail.utmCampaign || detail.referer) && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-sct-heading mb-2">
                  Attribution
                </h4>
                <div className="sct-card rounded-lg p-3 space-y-1.5">
                  {[
                    ["Source", detail.utmSource],
                    ["Medium", detail.utmMedium],
                    ["Campaign", detail.utmCampaign],
                    ["Content", detail.utmContent],
                    ["Term", detail.utmTerm],
                    ["Referer", detail.referer],
                  ]
                    .filter(([, v]) => v)
                    .map(([label, v]) => (
                      <div key={label as string} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-xs">
                        <div className="font-semibold text-sct-body uppercase tracking-wide">{label}</div>
                        <div className="text-sct-heading break-all">{v as string}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Payload */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-sct-heading mb-2">
                Application details
              </h4>
              <div className="sct-card rounded-lg p-3 space-y-1.5">
                {Object.entries(detail.payload || {}).length === 0 && (
                  <p className="text-xs text-sct-body italic">Empty payload.</p>
                )}
                {Object.entries(detail.payload || {}).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-2 text-xs">
                    <div className="font-semibold text-sct-body uppercase tracking-wide">{humaniseKey(k)}</div>
                    <div className="text-sct-heading whitespace-pre-wrap break-words">{renderPayloadValue(v)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-sct-heading mb-2">
                Internal notes
              </h4>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Notes for the team (not visible to the lead)"
                className="w-full rounded-lg border border-sct-surface px-3 py-2 text-sm text-sct-heading bg-sct-bg outline-none focus:border-sct-cta resize-y"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes || notesDraft === (detail.adminNotes ?? "")}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sct-cta disabled:opacity-40"
                >
                  {savingNotes ? "Saving..." : "Save notes"}
                </button>
              </div>
            </div>

            {/* Delete */}
            <div className="pt-3 border-t border-sct-surface">
              <button
                onClick={deleteApplication}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ background: "rgba(239,68,68,0.08)", color: "rgba(239,68,68,0.85)" }}
              >
                <Trash2 size={12} /> Delete (spam)
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
