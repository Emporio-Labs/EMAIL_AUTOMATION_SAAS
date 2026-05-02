"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

type CampaignItem = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  contacts_count: number;
  created_at: string;
  updated_at: string;
};

type CampaignResponse = { campaign: CampaignItem };

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

  async function handleSendCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !campaign) return;

    if (!fromAddress) {
      addToast("error", "Select a From address before sending.");
      return;
    }

    setSending(true);
    try {
      const result = await apiFetch<{ accepted: number }>("/v1/send", token, {
        method: "POST",
        body: JSON.stringify({
          subject: sendForm.subject,
          html: sendForm.html,
          from: fromAddress,
          campaignId: campaign.id,
          emailType: "marketing",
        }),
      });
      addToast("success", `Queued ${result.accepted} campaign email${result.accepted === 1 ? "" : "s"}.`);
      setSendForm({ subject: "", html: "" });
      setFromAddress("");
    } catch (err: any) {
      addToast("error", err?.message ?? "Failed to send campaign emails.");
    } finally {
      setSending(false);
    }
  }

  const subscribedCount = useMemo(
    () => campaignContacts.filter((contact) => contact.is_subscribed).length,
    [campaignContacts],
  );

  const unsubscribedCount = useMemo(
    () => campaignContacts.filter((contact) => !contact.is_subscribed).length,
    [campaignContacts],
  );

  const analytics = useMemo(() => {
    const sent = history.filter((item) => item.status === "sent").length;
    const failed = history.filter((item) => item.status === "failed").length;
    const queued = history.filter((item) => item.status === "queued").length;
    return { total: history.length, sent, failed, queued };
  }, [history]);

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

              <section className="mt-8 rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
                <div>
                  <h2 className="font-display text-2xl text-foreground">Send campaign</h2>
                  <p className="mt-1 text-sm text-muted">Recipients are loaded from campaign snapshot and filtered by subscription status.</p>
                </div>

                <form className="mt-6 flex flex-col gap-5" onSubmit={handleSendCampaign}>
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
                      className="min-h-[140px] rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
                      value={sendForm.html}
                      onChange={(e) => setSendForm({ ...sendForm, html: e.target.value })}
                      required
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={sending || subscribedCount === 0}
                    className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                  >
                    {sending ? "Sending..." : `Send to ${subscribedCount} subscribed contact${subscribedCount === 1 ? "" : "s"}`}
                  </button>
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
                  <div className="mt-4 grid gap-3 text-sm text-muted">
                    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"><span>Total</span><strong className="text-foreground">{analytics.total}</strong></div>
                    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"><span>Sent</span><strong className="text-foreground">{analytics.sent}</strong></div>
                    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"><span>Queued</span><strong className="text-foreground">{analytics.queued}</strong></div>
                    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"><span>Failed</span><strong className="text-foreground">{analytics.failed}</strong></div>
                  </div>
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
