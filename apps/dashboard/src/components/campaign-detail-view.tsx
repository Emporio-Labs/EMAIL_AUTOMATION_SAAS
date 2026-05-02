"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";

export type CampaignItem = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  target_list_id: string | null;
  opted_out_list_id: string | null;
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

type ListItem = { id: string; name: string; description: string | null };
type ListsResponse = { lists: ListItem[] };

type ListContact = {
  contact_id: string;
  contacts: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  };
};

type ListContactsResponse = { contacts: ListContact[] };

type CampaignSection = "target-list" | "opted-out-list" | "mail-history" | "analytics";

export function CampaignDetailView({ campaignId, section }: { campaignId: string; section: CampaignSection }) {
  const { token } = useAuth();

  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [history, setHistory] = useState<CampaignHistoryItem[]>([]);
  const [lists, setLists] = useState<ListItem[]>([]);
  const [listContacts, setListContacts] = useState<ListContact[]>([]);
  const [suppressionItems, setSuppressionItems] = useState<SuppressionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingListContacts, setLoadingListContacts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  function loadCampaignData() {
    if (!token || !campaignId) return;

    setLoading(true);
    Promise.all([
      apiFetch<CampaignResponse>(`/v1/campaigns/${campaignId}`, token),
      apiFetch<CampaignHistoryResponse>(`/v1/campaigns/${campaignId}/history`, token),
      apiFetch<SuppressionResponse>(`/v1/campaigns/${campaignId}/suppression`, token),
      apiFetch<ListsResponse>("/v1/lists", token),
    ])
      .then(([campaignResponse, historyResponse, suppressionResponse, listsResponse]) => {
        setCampaign(campaignResponse.campaign);
        setHistory(historyResponse.items);
        setSuppressionItems(suppressionResponse.items);
        setLists(listsResponse.lists);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load campaign"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCampaignData();
  }, [campaignId, token]);

  useEffect(() => {
    if (!token || !campaignId) return;

    const interval = window.setInterval(() => {
      loadCampaignData();
    }, 20000);

    return () => window.clearInterval(interval);
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
    const suppressedCount = suppressionItems.length;
    const complaintCount = suppressionItems.filter((item) => item.reason.toLowerCase() === "complaint").length;
    const bounceCount = suppressionItems.filter((item) => item.reason.toLowerCase() === "bounce").length;

    return { total, sent, failed, queued, deliveryRate, failureRate, recentDays, latestActivity, suppressedCount, complaintCount, bounceCount };
  }, [history, suppressionItems]);

  const selectedListId = section === "target-list" ? campaign?.target_list_id : campaign?.opted_out_list_id;
  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;

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

  useEffect(() => {
    if (!token || !selectedListId) return;

    setLoadingListContacts(true);
    apiFetch<ListContactsResponse>(`/v1/lists/${selectedListId}/contacts`, token)
      .then((response) => setListContacts(response.contacts))
      .catch(() => setListContacts([]))
      .finally(() => setLoadingListContacts(false));
  }, [selectedListId, token]);

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

          {section === "target-list" || section === "opted-out-list" ? (
            <div className="mt-6 rounded-2xl border border-border bg-surface-muted px-5 py-5">
              <p className="text-xs uppercase text-muted">{section === "target-list" ? "Target list" : "Opted out list"}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{selectedList?.name ?? selectedListId ?? "Not set"}</p>
              {selectedList?.description ? <p className="mt-1 text-sm text-muted">{selectedList.description}</p> : null}
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr className="border-b border-border">
                      <th className="px-2 py-3 text-left">Contact</th>
                      <th className="px-2 py-3 text-left">Name</th>
                      {section === "opted-out-list" ? <th className="px-2 py-3 text-left">Reason</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingListContacts ? (
                      <tr><td className="px-2 py-4 text-muted" colSpan={section === "opted-out-list" ? 3 : 2}>Loading list contacts...</td></tr>
                    ) : listContacts.length ? (
                      listContacts.map((item) => (
                        <tr key={item.contact_id} className="border-b border-border/60">
                          <td className="px-2 py-3 text-foreground">{item.contacts.email}</td>
                          <td className="px-2 py-3 text-muted">
                            {[item.contacts.first_name, item.contacts.last_name].filter(Boolean).join(" ") || "—"}
                          </td>
                          {section === "opted-out-list" ? <td className="px-2 py-3 text-muted">Suppressed</td> : null}
                        </tr>
                      ))
                    ) : (
                      <tr><td className="px-2 py-4 text-muted" colSpan={section === "opted-out-list" ? 3 : 2}>No contacts in this list yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

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

              <div className="grid gap-3 text-sm text-muted lg:grid-cols-3">
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Delivery rate</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.deliveryRate}%</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Failure rate</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.failureRate}%</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Latest activity</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {analytics.latestActivity ? new Date(analytics.latestActivity).toLocaleString() : "No activity yet"}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 text-sm text-muted lg:grid-cols-3">
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Suppressed</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.suppressedCount}</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Bounces</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.bounceCount}</p>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-4">
                  <p className="text-xs uppercase text-muted">Complaints</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{analytics.complaintCount}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface-muted px-5 py-5">
                <h3 className="font-display text-xl text-foreground">Recent activity by day</h3>
                <p className="mt-1 text-sm text-muted">Last recorded sends grouped by day.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {analytics.recentDays.length ? analytics.recentDays.map(([day, count]) => (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-xs text-muted">{day}</span>
                      <div className="h-2 flex-1 rounded-full bg-surface">
                        <div
                          className="h-2 rounded-full bg-accent-dark"
                          style={{ width: `${Math.max(8, Math.min(100, count * 18))}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs font-semibold text-foreground">{count}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-muted">No activity to chart yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/sends" className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-muted">
              Back to sends
            </Link>
            <Link href={`/sends/campaigns/${campaign.id}/target-list`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View target list
            </Link>
            <Link href={`/sends/campaigns/${campaign.id}/opted-out-list`} className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark">
              View opted out list
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