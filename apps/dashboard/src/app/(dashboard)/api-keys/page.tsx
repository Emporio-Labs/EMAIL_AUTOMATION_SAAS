"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

type ApiKey = {
  id: string;
  name: string;
  key_preview: string;
  type: "sandbox" | "production";
  created_at: string;
  last_used_at: string | null;
  revoked_at?: string | null;
};

type ApiKeysResponse = { apiKeys: ApiKey[] };

type CreateApiKeyResponse = { apiKey: ApiKey; key: string };

export default function ApiKeysPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; type: "sandbox" | "production" }>(
    { name: "", type: "sandbox" },
  );
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revoking, setRevoking] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => {
    const sandbox = items.filter((item) => item.type === "sandbox").length;
    const production = items.filter((item) => item.type === "production").length;
    return { sandbox, production, total: items.length };
  }, [items]);

  const limitReached = counts.total >= 5;

  function loadKeys() {
    if (!token) return;
    setLoading(true);
    apiFetch<ApiKeysResponse>("/v1/api-keys", token)
      .then((res) => {
        setItems(res.apiKeys);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load API keys"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadKeys();
  }, [token]);

  function openCreate() {
    setCreateForm({ name: "", type: "sandbox" });
    setCreateError(null);
    setCreatedKey(null);
    setCopied(false);
    setShowCreateModal(true);
  }

  function closeCreate() {
    setShowCreateModal(false);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setCreating(true);
    setCreateError(null);

    try {
      const res = await apiFetch<CreateApiKeyResponse>("/v1/api-keys", token, {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name,
          type: createForm.type,
        }),
      });
      setItems((prev) => [res.apiKey, ...prev]);
      setCreatedKey(res.key);
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!token || !confirm("Revoke this API key?")) return;
    setRevoking((prev) => ({ ...prev, [id]: true }));
    try {
      await apiFetch(`/v1/api-keys/${id}`, token, { method: "DELETE" });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(err?.message ?? "Failed to revoke API key");
    } finally {
      setRevoking((prev) => ({ ...prev, [id]: false }));
    }
  }

  function copyKey(value: string) {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="API keys" subtitle="Issue sandbox and production keys for developer sends." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl text-foreground">Developer API keys</h2>
              <p className="text-sm text-muted mt-1">
                Keys authenticate API calls to <span className="font-mono text-xs">/v1/send</span> using the
                <span className="font-mono text-xs"> x-api-key</span> header.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-border bg-surface-muted px-4 py-2 text-xs text-muted">
                Active {counts.total}/5
              </div>
              <button
                id="create-api-key-btn"
                onClick={openCreate}
                disabled={limitReached}
                className="h-10 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
              >
                + Create key
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-[radial-gradient(circle_at_top,_#e6f7ef,_#fbfaf5)] px-5 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Sandbox</p>
              <h3 className="mt-2 font-display text-xl text-foreground">Safe test sends</h3>
              <p className="mt-2 text-sm text-muted">
                Sandbox keys never touch SES. Jobs are marked delivered immediately.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-muted">
                <span className="font-mono">sk_test_</span> prefix
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-[linear-gradient(135deg,_#ffffff,_#f7f6f1)] px-5 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Production</p>
              <h3 className="mt-2 font-display text-xl text-foreground">Live customer sends</h3>
              <p className="mt-2 text-sm text-muted">
                Production keys queue to SQS and deliver through SES.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs text-accent-dark">
                <span className="font-mono">sk_prod_</span> prefix
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-surface-muted/60 px-5 py-4 text-sm text-muted">
            Keys are shown once on creation. Save them securely, then use them as the
            <span className="font-mono text-xs"> x-api-key</span> header in your API calls.
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Name</th>
                  <th className="px-2 py-3 text-left">Type</th>
                  <th className="px-2 py-3 text-left">Preview</th>
                  <th className="px-2 py-3 text-left">Created</th>
                  <th className="px-2 py-3 text-left">Last used</th>
                  <th className="px-2 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2 py-4 text-muted" colSpan={6}>Loading API keys...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-4 text-red-600" colSpan={6}>{error}</td></tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 transition-colors hover:bg-surface-muted/40">
                      <td className="px-2 py-3 text-foreground font-medium">{row.name}</td>
                      <td className="px-2 py-3">
                        <span
                          className={
                            row.type === "sandbox"
                              ? "inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-dark"
                              : "inline-flex items-center rounded-full bg-[#fff7e6] px-3 py-1 text-xs font-semibold text-[#a87412]"
                          }
                        >
                          {row.type}
                        </span>
                      </td>
                      <td className="px-2 py-3 font-mono text-foreground">{row.key_preview}</td>
                      <td className="px-2 py-3 text-muted">{formatDate(row.created_at)}</td>
                      <td className="px-2 py-3 text-muted">{row.last_used_at ? formatDateTime(row.last_used_at) : "Never"}</td>
                      <td className="px-2 py-3">
                        <button
                          onClick={() => handleRevoke(row.id)}
                          disabled={revoking[row.id]}
                          className="h-7 rounded-full border border-red-200 px-3 text-xs font-semibold text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          {revoking[row.id] ? "..." : "Revoke"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-8 text-center text-muted" colSpan={6}>
                      No API keys yet. Create one to start sending via the API.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {limitReached ? (
            <p className="mt-4 text-xs text-muted">Limit reached. Revoke a key to create a new one.</p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in-delay-1">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="font-display text-2xl">Quick start</h3>
              <p className="text-sm text-muted mt-1">Use this header for API requests.</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface-muted px-4 py-3 text-xs text-muted font-mono">
              x-api-key: sk_test_...
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface-muted/60 px-4 py-4 text-sm text-muted">
              Sandbox sends mark jobs as delivered instantly and skip SES entirely.
            </div>
            <div className="rounded-2xl border border-border bg-surface-muted/60 px-4 py-4 text-sm text-muted">
              Production keys queue to SQS and deliver through your verified domains.
            </div>
          </div>
        </section>
      </main>

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) closeCreate(); }}
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Create API key</h2>
              <button
                onClick={closeCreate}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                x
              </button>
            </div>

            {createdKey ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-border bg-surface-muted/60 px-4 py-4">
                  <p className="text-sm font-semibold text-foreground">Your key is ready</p>
                  <p className="text-xs text-muted mt-1">
                    This is the only time you will see the full key. Copy it now and store it safely.
                  </p>
                  <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono text-foreground break-all">
                    {createdKey}
                  </div>
                  <button
                    onClick={() => copyKey(createdKey)}
                    className="mt-3 h-9 w-full rounded-full border border-border text-xs font-semibold text-muted transition hover:bg-surface-muted"
                  >
                    {copied ? "Copied" : "Copy key"}
                  </button>
                </div>
                <button
                  onClick={closeCreate}
                  className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80"
                >
                  Done
                </button>
              </div>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleCreate}>
                <label className="flex flex-col gap-2 text-sm text-muted">
                  Key name
                  <input
                    id="api-key-name-input"
                    className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                    placeholder="e.g. staging app"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    required
                    autoFocus
                  />
                </label>

                <div className="flex flex-col gap-2 text-sm text-muted">
                  Key type
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, type: "sandbox" })}
                      className={
                        createForm.type === "sandbox"
                          ? "rounded-2xl border border-accent bg-accent-soft px-4 py-3 text-left text-xs font-semibold text-accent-dark"
                          : "rounded-2xl border border-border bg-surface-muted px-4 py-3 text-left text-xs font-semibold text-muted"
                      }
                    >
                      Sandbox key
                      <div className="mt-1 font-mono text-[11px]">sk_test_</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, type: "production" })}
                      className={
                        createForm.type === "production"
                          ? "rounded-2xl border border-accent bg-accent-soft px-4 py-3 text-left text-xs font-semibold text-accent-dark"
                          : "rounded-2xl border border-border bg-surface-muted px-4 py-3 text-left text-xs font-semibold text-muted"
                      }
                    >
                      Production key
                      <div className="mt-1 font-mono text-[11px]">sk_prod_</div>
                    </button>
                  </div>
                </div>

                {limitReached ? (
                  <p className="text-xs text-muted">Limit reached. Revoke a key to create a new one.</p>
                ) : null}

                {createError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{createError}</p>
                )}

                <div className="flex gap-3 mt-2">
                  <button
                    type="button"
                    onClick={closeCreate}
                    className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted"
                  >
                    Cancel
                  </button>
                  <button
                    id="create-api-key-submit"
                    type="submit"
                    disabled={creating || limitReached}
                    className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                  >
                    {creating ? "Creating..." : "Create key"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}
