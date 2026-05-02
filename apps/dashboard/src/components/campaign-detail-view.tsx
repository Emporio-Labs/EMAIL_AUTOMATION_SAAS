"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";

export type CampaignItem = {
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
  sent_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
};

type CampaignHistoryResponse = { items: CampaignHistoryItem[] };

type SuppressionItem = {
  id: string;
  email: string;
  reason: string;
  created_at: string;
};

type SuppressionResponse = { items: SuppressionItem[] };

type CampaignContactItem = {
  id: string;
  campaign_id: string;
  email: string;
  source_type: "list" | "manual";
  is_subscribed: boolean;
  created_at: string;
};

type CampaignContactsResponse = { contacts: CampaignContactItem[] };

type CampaignSection = "target-list" | "opted-out-list" | "mail-history" | "analytics";

export function CampaignDetailView({ campaignId, section }: { campaignId: string; section: CampaignSection }) {
  const { token } = useAuth();
  const router = useRouter();

  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [history, setHistory] = useState<CampaignHistoryItem[]>([]);
  const [campaignContacts, setCampaignContacts] = useState<CampaignContactItem[]>([]);
  const [suppressionItems, setSuppressionItems] = useState<SuppressionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  function loadCampaignData() {
    if (!token || !campaignId) return;

    setLoading(true);
    Promise.all([
      apiFetch<CampaignResponse>(`/v1/campaigns/${campaignId}`, token),
      apiFetch<CampaignHistoryResponse>(`/v1/campaigns/${campaignId}/history`, token),
      apiFetch<CampaignContactsResponse>(`/v1/campaigns/${campaignId}/contacts`, token),
      apiFetch<SuppressionResponse>(`/v1/campaigns/${campaignId}/suppression`, token),
    ])
      .then(([campaignResponse, historyResponse, contactsResponse, suppressionResponse]) => {
        setCampaign(campaignResponse.campaign);
        setHistory(historyResponse.items);
        setCampaignContacts(contactsResponse.contacts);
        setSuppressionItems(suppressionResponse.items);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load campaign"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCampaignData();
  }, [campaignId, token]);

  const analytics = useMemo(() => {
    const sent = history.filter((item) => item.status === "sent").length;
    const failed = history.filter((item) => item.status === "failed").length;
    const queued = history.filter((item) => item.status === "queued").length;
    const total = history.length;
    const deliveryRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    const failureRate = total > 0 ? Math.round((failed / total) * 100) : 0;

    const trendByDay = new Map<string, number>();
    for (const item of history) {
      const dayKey = new Date(item.created_at).toLocaleDateString();
      trendByDay.set(dayKey, (trendByDay.get(dayKey) ?? 0) + 1);
    }

    const recentDays = Array.from(trendByDay.entries()).slice(-7);
    const latestActivity = history[0]?.created_at ?? null;
    const subscribedRecipients = campaignContacts.filter((item) => item.is_subscribed).length;
    const unsubscribedRecipients = campaignContacts.filter((item) => !item.is_subscribed).length;
    const complaintCount = suppressionItems.filter((item) => item.reason.toLowerCase() === "complaint").length;
    const bounceCount = suppressionItems.filter((item) => item.reason.toLowerCase() === "bounce").length;

    return {
      total,
      sent,
      failed,
      queued,
      deliveryRate,
      failureRate,
      recentDays,
      latestActivity,
      subscribedRecipients,
      unsubscribedRecipients,
      complaintCount,
      bounceCount,
    };
  }, [history, suppressionItems, campaignContacts]);

  async function handleStatusChange(nextStatus: CampaignItem["status"]) {
    if (!token || !campaign) return;

    setUpdatingStatus(true);
    try {
      const response = await apiFetch<CampaignResponse>(`/v1/campaigns/${campaign.id}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });

      setCampaign(response.campaign);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleDeleteCampaign() {
    if (!token || !campaign) return;

    const confirmed = window.confirm("Delete this campaign? This will remove its saved recipient snapshot.");
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/v1/campaigns/${campaign.id}`, token, {
        method: "DELETE",
      });

      router.push("/sends");
    } catch (err: any) {
      const message = err?.message ?? "";
      if (typeof message === "string" && message.includes("[404]")) {
        router.push("/sends");
        return;
      }

      // keep the current page visible so the user can retry
    }
  }

  const recipientsView = campaignContacts;
  const unsubscribedView = campaignContacts.filter((item) => !item.is_subscribed);

  return (
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

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-4">
            <div>
              <p className="text-xs uppercase text-muted">Campaign status</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{campaign.status}</p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              {(["draft", "scheduled", "running", "paused", "completed"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleStatusChange(status)}
                  disabled={updatingStatus || campaign.status === status}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    campaign.status === status
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted hover:border-accent hover:text-accent-dark"
                  } disabled:opacity-50`}
                >
                  {updatingStatus && campaign.status !== status ? "Updating..." : status}
                </button>
              ))}
            </div>
          </div>

          {(section === "target-list" || section === "opted-out-list") && (
            <div className="mt-6 rounded-2xl border border-border bg-surface-muted px-5 py-5">
              <p className="text-xs uppercase text-muted">{section === "target-list" ? "Campaign recipients" : "Unsubscribed recipients"}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {section === "target-list" ? `${recipientsView.length} contacts` : `${unsubscribedView.length} unsubscribed`}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr className="border-b border-border">
                      <th className="px-2 py-3 text-left">Email</th>
                      <th className="px-2 py-3 text-left">Source</th>
                      <th className="px-2 py-3 text-left">Subscribed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(section === "target-list" ? recipientsView : unsubscribedView).length ? (
                      (section === "target-list" ? recipientsView : unsubscribedView).map((item) => (
                        <tr key={item.id} className="border-b border-border/60">
                          <td className="px-2 py-3 text-foreground">{item.email}</td>
                          <td className="px-2 py-3 text-muted capitalize">{item.source_type}</td>
                          <td className="px-2 py-3 text-muted">{item.is_subscribed ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td className="px-2 py-4 text-muted" colSpan={3}>No contacts found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === "mail-history" ? (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr className="border-b border-border">
                    <th className="px-2 py-3 text-left">Recipient</th>
                    <th className="px-2 py-3 text-left">Subject</th>
                    <th className="px-2 py-3 text-left">Status</th>
                    <th className="px-2 py-3 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length ? history.map((item) => (
                    <tr key={item.job_id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{item.to_email}</td>
                      <td className="px-2 py-3 text-muted">{item.subject}</td>
                      <td className="px-2 py-3 text-muted">{item.status}</td>
                      <td className="px-2 py-3 text-muted">{new Date(item.created_at).toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr><td className="px-2 py-4 text-muted" colSpan={4}>No mail history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {section === "analytics" ? (
            <div className="mt-6 space-y-4">
              <div className="grid gap-3 text-sm text-muted lg:grid-cols-4">
                <div className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"><span>Total</span><strong className="text-foreground">{analytics.total}</strong></div>
                <div className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"><span>Sent</span><strong className="text-foreground">{analytics.sent}</strong></div>
                <div className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"><span>Queued</span><strong className="text-foreground">{analytics.queued}</strong></div>
                <div className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3"><span>Failed</span><strong className="text-foreground">{analytics.failed}</strong></div>
              </div>

              <div className="grid gap-3 text-sm text-muted lg:grid-cols-4">
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Delivery rate</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.deliveryRate}%</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Failure rate</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.failureRate}%</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Subscribed recipients</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.subscribedRecipients}</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Unsubscribed recipients</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.unsubscribedRecipients}</p>
                </div>
              </div>

              <div className="grid gap-3 text-sm text-muted lg:grid-cols-2">
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Bounces</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.bounceCount}</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Complaints</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.complaintCount}</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/sends" className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-muted">
              Back to sends
            </Link>
            <button
              type="button"
              onClick={() => void handleDeleteCampaign()}
              className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
            >
              Delete campaign
            </button>
            <Link href={`/sends/campaigns/${campaign.id}/target-list`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View recipients
            </Link>
            <Link href={`/sends/campaigns/${campaign.id}/opted-out-list`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View unsubscribed
            </Link>
            <Link href={`/sends/campaigns/${campaign.id}/mail-history`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View mail history
            </Link>
            <Link href={`/sends/campaigns/${campaign.id}/analytics`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View analytics
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
