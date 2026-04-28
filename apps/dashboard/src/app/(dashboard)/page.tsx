"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { MetricCard } from "@/components/metric-card";
import { StatusPill } from "@/components/status-pill";
import { VolumeChart } from "@/components/volume-chart";

type OverviewResponse = {
  rangeDays: number;
  totals: {
    sent: number;
    queued: number;
    delivered: number;
    failed: number;
  };
  volume: Array<{ date: string; total: number }>;
  suppression: {
    bounceCount: number;
    complaintCount: number;
    bounceRate: number;
    complaintRate: number;
  };
  recent: Array<{
    job_id: string;
    to_email: string;
    subject: string;
    status: string;
    created_at: string;
    sent_at: string | null;
    failed_at: string | null;
  }>;
};

export default function OverviewPage() {
  const { token } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    apiFetch<OverviewResponse>("/v1/analytics/overview?days=30", token)
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((err) => {
        setError(err?.message ?? "Failed to load analytics");
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Overview" subtitle="Live tenant analytics and recent activity." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1 text-xs font-semibold text-accent-dark">
                Built for the Next Billion Indian Businesses
              </div>
              <h2 className="font-display mt-4 text-3xl text-foreground">Campaign Performance</h2>
              <p className="mt-2 text-sm text-muted">Last 30 days snapshot across all outbound sends.</p>
            </div>
            <div className="text-xs text-muted">Updated just now</div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <MetricCard label="Emails Sent" value={data?.totals.sent ?? "—"} />
            <MetricCard label="Delivered" value={data?.totals.delivered ?? "—"} />
            <MetricCard label="Queued" value={data?.totals.queued ?? "—"} />
            <MetricCard label="Failed" value={data?.totals.failed ?? "—"} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Send Volume</p>
                <p className="text-xs text-muted">Last 30 days</p>
              </div>
              <div className="mt-4">
                {data?.volume ? <VolumeChart data={data.volume} /> : <div className="h-28" />}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Suppression</p>
              <div className="mt-4 space-y-3 text-sm text-foreground">
                <div className="flex items-center justify-between">
                  <span>Bounce rate</span>
                  <strong>{formatPercent(data?.suppression.bounceRate)}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Complaint rate</span>
                  <strong>{formatPercent(data?.suppression.complaintRate)}</strong>
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Bounces</span>
                  <span>{data?.suppression.bounceCount ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Complaints</span>
                  <span>{data?.suppression.complaintCount ?? "—"}</span>
                </div>
              </div>
              <div className="mt-6 rounded-xl bg-white px-3 py-2 text-xs text-muted">
                ✨ AI Tip: Your "Weekend Sale" email is performing 12% better than average.
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in-delay-1">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">Recent activity</h3>
            <span className="text-xs text-muted">Last 20 sends</span>
          </div>

          <div className="mt-4 overflow-x-auto">
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
                {loading ? (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={4}>
                      Loading recent activity...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="px-2 py-4 text-red-600" colSpan={4}>
                      {error}
                    </td>
                  </tr>
                ) : data?.recent.length ? (
                  data.recent.map((row) => (
                    <tr key={row.job_id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{row.to_email}</td>
                      <td className="px-2 py-3 text-muted">{row.subject}</td>
                      <td className="px-2 py-3">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={4}>
                      No sends found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return `${(value * 100).toFixed(1)}%`;
}
