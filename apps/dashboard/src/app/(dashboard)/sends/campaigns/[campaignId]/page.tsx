"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { MERGE_TAG_HELP, TemplatePicker } from "@/components/template-picker";

type CampaignItem = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed" | "failed";
  subject: string | null;
  html: string | null;
  from_email: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  contacts_count: number;
  created_at: string;
  updated_at: string;
};

type CampaignResponse = { campaign: CampaignItem };

type CampaignStats = {
  recipients: number;
  pending: number;
  skipped: number;
  sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  rates: { delivered: number; opened: number; clicked: number; bounced: number };
};

const EDITABLE_STATUSES: CampaignItem["status"][] = ["draft", "scheduled", "failed"];

// <input type="datetime-local"> works in local time without a zone.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type CampaignHistoryItem = {
  job_id: string;
  from_email: string;
  to_email: string;
  subject: string;
  status: string;
  email_type: string;
  created_at: string;
};
type CampaignHistoryResponse = { items: CampaignHistoryItem[] };

type CampaignContact = {
  id: string;
  email: string;
  source_type: "list" | "manual";
  is_subscribed: boolean;
};
type CampaignContactsResponse = { contacts: CampaignContact[] };

type SendingAddress = {
  id: string;
  address: string;
  label: string | null;
};
type SendingAddressesResponse = { addresses: SendingAddress[] };

let toastCounter = 0;
type Toast = { id: number; type: "success" | "error"; message: string };

export default function CampaignDetailPage() {
  const { token } = useAuth();
  const params = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [history, setHistory] = useState<CampaignHistoryItem[]>([]);
  const [campaignContacts, setCampaignContacts] = useState<CampaignContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sendingAddresses, setSendingAddresses] = useState<SendingAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [sendForm, setSendForm] = useState({ subject: "", html: "" });
  const [sending, setSending] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(type: Toast["type"], message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  useEffect(() => {
    if (!token || !params.campaignId) return;

    setLoading(true);
    Promise.all([
      apiFetch<CampaignResponse>(`/v1/campaigns/${params.campaignId}`, token),
      apiFetch<CampaignHistoryResponse>(`/v1/campaigns/${params.campaignId}/history`, token),
      apiFetch<CampaignContactsResponse>(`/v1/campaigns/${params.campaignId}/contacts`, token),
    ])
      .then(([campaignResponse, historyResponse, contactsResponse]) => {
        setCampaign(campaignResponse.campaign);
        setSendForm({ subject: campaignResponse.campaign.subject ?? "", html: campaignResponse.campaign.html ?? "" });
        setFromAddress(campaignResponse.campaign.from_email ?? "");
        setScheduleAt(toLocalInput(campaignResponse.campaign.scheduled_at));
        setHistory(historyResponse.items);
        setCampaignContacts(contactsResponse.contacts);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load campaign"))
      .finally(() => setLoading(false));
  }, [params.campaignId, token]);

  useEffect(() => {
    if (!token) return;
    setLoadingAddresses(true);
    apiFetch<SendingAddressesResponse>("/v1/sending-addresses", token)
      .then((res) => setSendingAddresses(res.addresses))
      .catch(() => {})
      .finally(() => setLoadingAddresses(false));
  }, [token]);

  // Poll progress while the campaign is queued or sending.
  useEffect(() => {
    if (!token || !params.campaignId) return;
    let cancelled = false;
    const load = () =>
      Promise.all([
        apiFetch<{ stats: CampaignStats }>(`/v1/campaigns/${params.campaignId}/stats`, token),
        apiFetch<CampaignResponse>(`/v1/campaigns/${params.campaignId}`, token),
      ])
        .then(([statsResponse, campaignResponse]) => {
          if (cancelled) return;
          setStats(statsResponse.stats);
          setCampaign(campaignResponse.campaign);
        })
        .catch(() => {});
    void load();
    const active = campaign?.status === "running" || campaign?.status === "scheduled";
    const timer = active ? setInterval(load, 5000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [params.campaignId, token, campaign?.status]);

  async function saveContent(): Promise<boolean> {
    if (!token || !campaign) return false;
    if (!fromAddress) {
      addToast("error", "Select a From address first.");
      return false;
    }
    try {
      const res = await apiFetch<CampaignResponse>(`/v1/campaigns/${campaign.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ subject: sendForm.subject, html: sendForm.html, fromEmail: fromAddress }),
      });
      setCampaign(res.campaign);
      return true;
    } catch (err: any) {
      addToast("error", err?.message ?? "Failed to save campaign.");
      return false;
    }
  }

  async function runAction(action: "send-now" | "schedule" | "pause" | "resume" | "cancel", body?: object) {
    if (!token || !campaign) return;
    setSending(true);
    try {
      if ((action === "send-now" || action === "schedule") && !(await saveContent())) return;
      const res = await apiFetch<CampaignResponse>(`/v1/campaigns/${campaign.id}/${action}`, token, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      setCampaign(res.campaign);
      const messages = {
        "send-now": "Sending starts within a few seconds.",
        schedule: `Scheduled for ${new Date(res.campaign.scheduled_at ?? "").toLocaleString()}.`,
        pause: "Campaign paused.",
        resume: "Campaign resumed.",
        cancel: "Schedule cancelled. The campaign is a draft again.",
      };
      addToast("success", messages[action]);
    } catch (err: any) {
      addToast("error", err?.message ?? "Action failed.");
    } finally {
      setSending(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    if (await saveContent()) addToast("success", "Campaign saved.");
    setSending(false);
  }

  function handleSchedule() {
    if (!scheduleAt) {
      addToast("error", "Pick a date and time first.");
      return;
    }
    void runAction("schedule", { scheduledAt: new Date(scheduleAt).toISOString() });
  }

  const subscribedCount = useMemo(
    () => campaignContacts.filter((contact) => contact.is_subscribed).length,
    [campaignContacts],
  );

  const unsubscribedCount = useMemo(
    () => campaignContacts.filter((contact) => !contact.is_subscribed).length,
    [campaignContacts],
  );


  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Campaign details" subtitle="Campaign recipient snapshot and send execution." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <div className="flex items-center gap-3">
          <Link href="/sends" className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-muted">
            Back to sends
          </Link>
        </div>

        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          {loading ? (
            <p className="text-sm text-muted">Loading campaign...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : campaign ? (
            <>
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-3xl text-foreground">{campaign.name}</h2>
                <p className="text-sm text-muted">{campaign.description ?? "No description provided."}</p>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-4">
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Campaign contacts</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{campaignContacts.length}</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Subscribed</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{subscribedCount}</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Unsubscribed</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{unsubscribedCount}</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Status</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{campaign.status}</p>
                </div>
              </div>

              {campaign.last_error ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {campaign.last_error}
                </div>
              ) : null}

              <section className="mt-8 rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-2xl text-foreground">Content and schedule</h2>
                    <p className="mt-1 text-sm text-muted">
                      {campaign.status === "scheduled" && campaign.scheduled_at
                        ? `Scheduled for ${new Date(campaign.scheduled_at).toLocaleString()}.`
                        : campaign.status === "running"
                          ? "Sending now. Pausing stops it after the current batch."
                          : campaign.status === "paused"
                            ? "Paused. Resume to continue where it stopped."
                            : campaign.status === "completed"
                              ? `Finished${campaign.completed_at ? ` ${new Date(campaign.completed_at).toLocaleString()}` : ""}.`
                              : "Unsubscribed and bounced contacts are skipped automatically."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(campaign.status === "running" || campaign.status === "scheduled") && (
                      <button type="button" disabled={sending} onClick={() => runAction("pause")} className="h-10 rounded-full border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:opacity-60">Pause</button>
                    )}
                    {campaign.status === "paused" && (
                      <button type="button" disabled={sending} onClick={() => runAction("resume")} className="h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60">Resume</button>
                    )}
                    {campaign.status === "scheduled" && (
                      <button type="button" disabled={sending} onClick={() => runAction("cancel")} className="h-10 rounded-full border border-border px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:opacity-60">Cancel schedule</button>
                    )}
                  </div>
                </div>

                <form className="mt-6 flex flex-col gap-5" onSubmit={handleSave}>
                  <fieldset disabled={!EDITABLE_STATUSES.includes(campaign.status) || sending} className="flex flex-col gap-5 disabled:opacity-70">
                    <TemplatePicker token={token} onPick={(t) => setSendForm({ subject: t.subject, html: t.html })} />
                    <label className="flex flex-col gap-2 text-sm text-muted">
                      From address *
                      <select
                        className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                        value={fromAddress}
                        onChange={(e) => setFromAddress(e.target.value)}
                        disabled={loadingAddresses || sendingAddresses.length === 0}
                        required
                      >
                        <option value="">Select a sending address</option>
                        {sendingAddresses.map((addr) => (
                          <option key={addr.id} value={addr.address}>
                            {addr.label ? `${addr.label} - ${addr.address}` : addr.address}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-muted">
                      Subject *
                      <input
                        className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                        value={sendForm.subject}
                        onChange={(e) => setSendForm({ ...sendForm, subject: e.target.value })}
                        required
                      />
                    </label>

                    <label className="flex flex-col gap-2 text-sm text-muted">
                      HTML body *
                      <textarea
                        className="min-h-[160px] rounded-xl border border-border bg-surface-muted px-4 py-3 font-mono text-sm text-foreground outline-none focus:border-accent"
                        value={sendForm.html}
                        onChange={(e) => setSendForm({ ...sendForm, html: e.target.value })}
                        required
                      />
                      <span className="text-xs">{MERGE_TAG_HELP}</span>
                    </label>

                    <div className="flex flex-wrap items-end gap-3">
                      <button type="submit" className="h-11 rounded-full border border-border px-5 text-sm font-semibold text-foreground transition hover:bg-surface-muted">
                        Save draft
                      </button>
                      <label className="flex flex-col gap-2 text-sm text-muted">
                        Send at
                        <input
                          type="datetime-local"
                          className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                          value={scheduleAt}
                          min={toLocalInput(new Date().toISOString())}
                          onChange={(e) => setScheduleAt(e.target.value)}
                        />
                      </label>
                      <button type="button" onClick={handleSchedule} className="h-11 rounded-full border border-border px-5 text-sm font-semibold text-foreground transition hover:bg-surface-muted">
                        Schedule
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction("send-now")}
                        disabled={subscribedCount === 0}
                        className="h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                      >
                        {`Send now to ${subscribedCount} contact${subscribedCount === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </fieldset>
                </form>
              </section>

              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-border bg-surface-muted px-5 py-5">
                  <h3 className="font-display text-xl text-foreground">Mail history</h3>
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase text-muted">
                        <tr className="border-b border-border">
                          <th className="px-2 py-3 text-left">Recipient</th>
                          <th className="px-2 py-3 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length ? history.slice(0, 8).map((item) => (
                          <tr key={item.job_id} className="border-b border-border/60">
                            <td className="px-2 py-3 text-foreground">{item.to_email}</td>
                            <td className="px-2 py-3 text-muted">{item.status}</td>
                          </tr>
                        )) : (
                          <tr><td className="px-2 py-4 text-muted" colSpan={2}>No mail history yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-surface-muted px-5 py-5">
                  <h3 className="font-display text-xl text-foreground">Analytics</h3>
                  {stats ? (
                    <>
                      {stats.recipients > 0 && (
                        <div className="mt-4">
                          <div className="flex justify-between text-xs text-muted">
                            <span>Progress</span>
                            <span>{stats.recipients - stats.pending} of {stats.recipients}</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface">
                            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((stats.recipients - stats.pending) / stats.recipients) * 100}%` }} />
                          </div>
                        </div>
                      )}
                      <div className="mt-4 grid gap-3 text-sm text-muted">
                        {[
                          ["Sent", stats.sent, null],
                          ["Delivered", stats.delivered, stats.rates.delivered],
                          ["Opened", stats.opened, stats.rates.opened],
                          ["Clicked", stats.clicked, stats.rates.clicked],
                          ["Bounced", stats.bounced, stats.rates.bounced],
                          ["Failed", stats.failed, null],
                          ["Skipped (unsubscribed or suppressed)", stats.skipped, null],
                        ].map(([label, value, rate]) => (
                          <div key={label as string} className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                            <span>{label}</span>
                            <strong className="text-foreground">
                              {value as number}
                              {rate !== null ? <span className="ml-2 text-xs font-normal text-muted">{rate as number}%</span> : null}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-muted">Loading stats...</p>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </section>

        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-5 py-4 shadow-lg text-sm font-medium max-w-sm fade-in ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}
            >
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button onClick={() => dismissToast(toast.id)} className="shrink-0 opacity-60 hover:opacity-100 transition leading-none text-lg mt-[-2px]" aria-label="Dismiss">x</button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
