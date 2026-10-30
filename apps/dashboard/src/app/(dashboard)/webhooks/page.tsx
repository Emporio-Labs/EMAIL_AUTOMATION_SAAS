"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

type Webhook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type WebhookResponse = { webhook: Webhook | null; availableEvents: string[]; allowed: boolean };

type Delivery = {
  id: string;
  event_type: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
};

const STATUS_STYLES: Record<Delivery["status"], string> = {
  succeeded: "bg-accent-soft text-accent-dark",
  pending: "bg-[#fff7e6] text-[#a87412]",
  failed: "bg-red-50 text-red-700",
};

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export default function WebhooksPage() {
  const { token } = useAuth();
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  function load() {
    if (!token) return;
    setLoading(true);
    Promise.all([
      apiFetch<WebhookResponse>("/v1/webhooks", token),
      apiFetch<{ deliveries: Delivery[] }>("/v1/webhooks/deliveries?limit=50", token),
    ])
      .then(([res, log]) => {
        setWebhook(res.webhook);
        setAvailableEvents(res.availableEvents);
        setAllowed(res.allowed);
        setUrl(res.webhook?.url ?? "");
        setEvents(res.webhook?.events ?? res.availableEvents);
        setEnabled(res.webhook?.enabled ?? true);
        setDeliveries(log.deliveries);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err) ?? "Failed to load webhook"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [token]);

  function toggleEvent(name: string) {
    setEvents((prev) => (prev.includes(name) ? prev.filter((e) => e !== name) : [...prev, name]));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ webhook: Webhook }>("/v1/webhooks", token, {
        method: "PUT",
        body: JSON.stringify({ url, events, enabled }),
      });
      setWebhook(res.webhook);
      setNotice("Webhook saved.");
    } catch (err) {
      setNotice(errorMessage(err) ?? "Failed to save webhook");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!token) return;
    setNotice("Sending test event...");
    try {
      const res = await apiFetch<{ ok: boolean; statusCode: number | null; error?: string }>("/v1/webhooks/test", token, { method: "POST" });
      setNotice(res.ok ? `Test event delivered (HTTP ${res.statusCode}).` : `Test failed: ${res.error ?? `HTTP ${res.statusCode}`}`);
    } catch (err) {
      setNotice(errorMessage(err) ?? "Failed to send test event");
    }
  }

  async function handleRotate() {
    if (!token || !confirm("Rotate the signing secret? Your receiver must switch to the new one.")) return;
    try {
      const res = await apiFetch<{ webhook: Webhook }>("/v1/webhooks/rotate-secret", token, { method: "POST" });
      setWebhook(res.webhook);
      setShowSecret(true);
      setNotice("Secret rotated.");
    } catch (err) {
      setNotice(errorMessage(err) ?? "Failed to rotate secret");
    }
  }

  async function handleDelete() {
    if (!token || !confirm("Delete this webhook? Pending deliveries are dropped.")) return;
    try {
      await apiFetch("/v1/webhooks", token, { method: "DELETE" });
      setNotice("Webhook deleted.");
      load();
    } catch (err) {
      setNotice(errorMessage(err) ?? "Failed to delete webhook");
    }
  }

  async function handleRetry(id: string) {
    if (!token) return;
    try {
      await apiFetch(`/v1/webhooks/deliveries/${id}/retry`, token, { method: "POST" });
      setDeliveries((prev) => prev.map((d) => (d.id === id ? { ...d, status: "pending" } : d)));
    } catch (err) {
      alert(errorMessage(err) ?? "Failed to retry delivery");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Webhooks" subtitle="Get notified when your emails are sent, delivered, opened, bounced or fail." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
          <h2 className="font-display text-2xl text-foreground">Endpoint</h2>
          <p className="text-sm text-muted mt-1">
            One URL per account. Every request is a JSON POST signed with
            <span className="font-mono text-xs"> Swayam-Signature: t=…,v1=…</span> (HMAC-SHA256 of
            <span className="font-mono text-xs"> t + &quot;.&quot; + body</span>). Failed deliveries are retried for about 21 hours.
          </p>

          {loading ? (
            <p className="mt-6 text-sm text-muted">Loading webhook...</p>
          ) : error ? (
            <p className="mt-6 text-sm text-red-600">{error}</p>
          ) : !allowed ? (
            <div className="mt-6 rounded-2xl border border-border bg-surface-muted/60 px-5 py-4 text-sm text-muted">
              Webhooks are not included in your current plan. Upgrade to Growth or above, or contact support.
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-6 flex flex-col gap-5">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-foreground">URL</span>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-dashboard.com/webhooks/swayam"
                  className="h-11 rounded-xl border border-border bg-background px-4 font-mono text-xs"
                />
              </label>

              <div className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-foreground">Events</span>
                <div className="flex flex-wrap gap-2">
                  {availableEvents.map((name) => (
                    <label key={name} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs">
                      <input type="checkbox" checked={events.includes(name)} onChange={() => toggleEvent(name)} />
                      <span className="font-mono">{name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>Enabled</span>
              </label>

              {webhook && (
                <div className="rounded-2xl border border-border bg-surface-muted/60 px-5 py-4 text-sm">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Signing secret</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <code className="font-mono text-xs text-foreground break-all">
                      {showSecret ? webhook.secret : `${webhook.secret.slice(0, 10)}••••••••••••`}
                    </code>
                    <button type="button" onClick={() => setShowSecret((v) => !v)} className="text-xs font-semibold text-accent-dark">
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(webhook.secret)} className="text-xs font-semibold text-accent-dark">
                      Copy
                    </button>
                    <button type="button" onClick={handleRotate} className="text-xs font-semibold text-red-600">
                      Rotate
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving || events.length === 0}
                  className="h-10 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                >
                  {saving ? "Saving..." : webhook ? "Save changes" : "Create webhook"}
                </button>
                {webhook && (
                  <>
                    <button type="button" onClick={handleTest} className="h-10 rounded-full border border-border px-5 text-sm font-semibold">
                      Send test event
                    </button>
                    <button type="button" onClick={handleDelete} className="h-10 rounded-full px-5 text-sm font-semibold text-red-600">
                      Delete
                    </button>
                  </>
                )}
                {notice && <span className="text-sm text-muted">{notice}</span>}
              </div>
            </form>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-foreground">Recent deliveries</h2>
            <button onClick={load} className="text-sm font-semibold text-accent-dark">Refresh</button>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Event</th>
                  <th className="px-2 py-3 text-left">Email</th>
                  <th className="px-2 py-3 text-left">Status</th>
                  <th className="px-2 py-3 text-left">Attempts</th>
                  <th className="px-2 py-3 text-left">Last response</th>
                  <th className="px-2 py-3 text-left">Created</th>
                  <th className="px-2 py-3 text-left"></th>
                </tr>
              </thead>
              <tbody>
                {deliveries.length ? (
                  deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-border/60">
                      <td className="px-2 py-3 font-mono text-xs">{d.event_type}</td>
                      <td className="px-2 py-3 text-xs text-muted">{String(d.payload.subject ?? "")}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[d.status]}`}>{d.status}</span>
                      </td>
                      <td className="px-2 py-3 text-muted">{d.attempts}</td>
                      <td className="px-2 py-3 text-xs text-muted">
                        {d.last_status_code ? `HTTP ${d.last_status_code}` : d.last_error ?? "—"}
                      </td>
                      <td className="px-2 py-3 text-xs text-muted">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="px-2 py-3">
                        {d.status === "failed" && (
                          <button onClick={() => handleRetry(d.id)} className="text-xs font-semibold text-accent-dark">Retry</button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td className="px-2 py-4 text-muted" colSpan={7}>No deliveries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
