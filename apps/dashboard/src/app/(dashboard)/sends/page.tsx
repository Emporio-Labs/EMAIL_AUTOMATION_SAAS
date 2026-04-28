"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";

type SendItem = {
  job_id: string;
  from_email: string;
  to_email: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
};

type SendsResponse = {
  page: number;
  limit: number;
  total: number;
  items: SendItem[];
};

export default function SendsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<SendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", html: "", toEmails: "" });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

  const recipients = useMemo(
    () =>
      form.toEmails
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    [form.toEmails],
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    apiFetch<SendsResponse>("/v1/sends", token)
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load sends"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setSendResult(null);

    try {
      const result = await apiFetch<{ accepted: number }>("/v1/send", token, {
        method: "POST",
        body: JSON.stringify({
          subject: form.subject,
          html: form.html,
          toEmails: recipients,
        }),
      });

      setSendResult(`Queued ${result.accepted} emails.`);
      setForm({ subject: "", html: "", toEmails: "" });
    } catch (err: any) {
      setSendResult(err?.message ?? "Failed to send emails.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Sends" subtitle="Trigger new sends and monitor delivery status." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr] fade-in">
          <div className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Send a campaign</h2>
            <p className="mt-2 text-sm text-muted">Paste recipients as comma-separated emails.</p>

            <form className="mt-6 flex flex-col gap-4" onSubmit={handleSend}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Subject
                <input
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Recipients
                <input
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="sagunvarma25@gmail.com, yeshwanthdandu2003@gmail.com"
                  value={form.toEmails}
                  onChange={(event) => setForm({ ...form, toEmails: event.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                HTML body
                <textarea
                  className="min-h-[140px] rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="<p>Welcome to SwayamMail...</p>"
                  value={form.html}
                  onChange={(event) => setForm({ ...form, html: event.target.value })}
                  required
                />
              </label>

              {sendResult ? <p className="text-sm text-muted">{sendResult}</p> : null}

              <button
                type="submit"
                className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a]"
                disabled={sending}
              >
                {sending ? "Sending..." : "Send emails"}
              </button>
            </form>
          </div>

          <div className="rounded-3xl border border-border bg-surface-muted px-6 py-6">
            <h3 className="font-display text-xl">Delivery snapshot</h3>
            <p className="mt-2 text-sm text-muted">
              Track queued, delivered, and failed messages in the Sends table below.
            </p>
            <div className="mt-6 flex flex-col gap-3 text-sm text-muted">
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                <span>Queue priority</span>
                <strong className="text-foreground">Standard</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                <span>Sends today</span>
                <strong className="text-foreground">Live</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                <span>Delivery window</span>
                <strong className="text-foreground">Instant</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in-delay-1">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">Recent sends</h3>
            <span className="text-xs text-muted">Latest 20</span>
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
                      Loading sends...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="px-2 py-4 text-red-600" colSpan={4}>
                      {error}
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((row) => (
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
