"use client";

import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { DomainSetupFlow, DomainRow } from "@/components/domain-setup-flow";

// ── Types ──────────────────────────────────────────────────────────────────────

type Domain = DomainRow;

type DomainsResponse = { domains: Domain[] };
type VerifyResponse  = { verified: boolean; message?: string; domain?: Domain };
type RecordsResponse = { domain: Domain; dnsRecords: DnsRecord[] };

import type { DnsRecord } from "@/components/domain-setup-flow";

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DomainsPage() {
  const { token } = useAuth();
  const [items, setItems]   = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  // Add domain modal — now just a boolean; all flow lives in DomainSetupFlow
  const [showAddModal, setShowAddModal] = useState(false);

  // DNS records viewer modal
  const [dnsModal, setDnsModal] = useState<{ domain: Domain; records: DnsRecord[] } | null>(null);
  const [loadingDns, setLoadingDns] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  // Per-row verify state (table "Check DNS" buttons)
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [verifyResult, setVerifyResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Per-row delete state
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  // ── Load ──────────────────────────────────────────────────────────────────

  function loadDomains() {
    if (!token) return;
    setLoading(true);
    apiFetch<DomainsResponse>("/v1/domains", token)
      .then((res) => { setItems(res.domains); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load domains"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadDomains(); }, [token]);

  // ── DomainSetupFlow callback ───────────────────────────────────────────────
  // Called when user finishes (verified or skipped) the 3-step flow in the modal.

  function handleSetupComplete(domain: DomainRow) {
    // Upsert into the local list so the table updates instantly
    setItems((prev) => {
      const exists = prev.find((d) => d.id === domain.id);
      if (exists) return prev.map((d) => (d.id === domain.id ? domain : d));
      return [domain, ...prev];
    });
    setShowAddModal(false);
  }

  // ── Per-row verify (table "Check DNS" button) ─────────────────────────────

  async function handleVerify(domainId: string) {
    if (!token) return;
    setVerifying((p) => ({ ...p, [domainId]: true }));
    setVerifyResult((p) => ({ ...p, [domainId]: { ok: false, message: "" } }));
    try {
      const res = await apiFetch<VerifyResponse>(`/v1/domains/${domainId}/verify`, token);
      if (res.verified) {
        if (res.domain) setItems((p) => p.map((d) => (d.id === domainId ? res.domain! : d)));
        setVerifyResult((p) => ({ ...p, [domainId]: { ok: true, message: "✅ Domain verified!" } }));
      } else {
        setVerifyResult((p) => ({
          ...p,
          [domainId]: { ok: false, message: res.message ?? "DNS not yet detected. Try again after propagation." },
        }));
      }
    } catch (err: any) {
      setVerifyResult((p) => ({ ...p, [domainId]: { ok: false, message: err?.message ?? "Verification failed" } }));
    } finally {
      setVerifying((p) => ({ ...p, [domainId]: false }));
    }
  }

  // ── Fetch DNS records for a domain ──────────────────────────────────────

  async function handleViewDns(row: Domain) {
    if (!token) return;
    setLoadingDns((p) => ({ ...p, [row.id]: true }));
    try {
      const res = await apiFetch<RecordsResponse>(`/v1/domains/${row.id}/records`, token);
      setDnsModal({ domain: row, records: res.dnsRecords });
    } catch (err: any) {
      alert(err?.message ?? "Failed to load DNS records");
    } finally {
      setLoadingDns((p) => ({ ...p, [row.id]: false }));
    }
  }

  function copyField(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied((p) => ({ ...p, [key]: true }));
    setTimeout(() => setCopied((p) => ({ ...p, [key]: false })), 2000);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(domainId: string) {
    if (!token || !confirm("Remove this domain?")) return;
    setDeleting((p) => ({ ...p, [domainId]: true }));
    try {
      await apiFetch(`/v1/domains/${domainId}`, token, { method: "DELETE" });
      setItems((p) => p.filter((d) => d.id !== domainId));
    } catch (err: any) {
      alert(err?.message ?? "Failed to delete domain");
    } finally {
      setDeleting((p) => ({ ...p, [domainId]: false }));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Domains" subtitle="Manage verified sending domains for your tenant." />
      <main className="flex flex-col gap-6 px-6 py-8">

        <section className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="font-display text-2xl text-foreground">Sending Domains</h2>
              <p className="text-sm text-muted mt-1">
                Only verified domains can be used in the <code className="bg-surface-muted rounded px-1 text-xs">from</code> field.
              </p>
            </div>
            <button
              id="open-add-domain-modal"
              onClick={() => setShowAddModal(true)}
              className="h-10 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:bg-[#2a2a2a]"
            >
              + Add domain
            </button>
          </div>

          {/* Info banner */}
          <div className="mt-4 rounded-2xl border border-border bg-surface-muted/50 px-5 py-4 text-sm text-muted leading-relaxed">
            <span className="font-semibold text-foreground">Before sending</span>, add your sending domain here.
            We register it with AWS SES and give you <strong>5 DNS records</strong> (SPF + DMARC + 3 DKIM CNAMEs) to publish.
            Once published, click <em>Check DNS</em> — SES confirms DKIM and unlocks sending from that domain.
          </div>

          {/* Domains table */}
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Domain</th>
                  <th className="px-2 py-3 text-left">Status</th>
                  <th className="px-2 py-3 text-left">Added</th>
                  <th className="px-2 py-3 text-left">Verified at</th>
                  <th className="px-2 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2 py-6 text-muted" colSpan={5}>Loading domains...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-6 text-red-600" colSpan={5}>{error}</td></tr>
                ) : items.length > 0 ? (
                  items.map((row) => (
                    <Fragment key={row.id}>
                      <tr className="border-b border-border/60 transition-colors hover:bg-surface-muted/40">
                        {/* Domain */}
                        <td className="px-2 py-3 font-mono text-foreground font-medium">{row.domain}</td>

                        {/* Status pill */}
                        <td className="px-2 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                            row.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${row.verified ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {row.verified ? "Verified" : "Pending DNS"}
                          </span>
                        </td>

                        {/* Added */}
                        <td className="px-2 py-3 text-muted">{new Date(row.created_at).toLocaleDateString()}</td>

                        {/* Verified at */}
                        <td className="px-2 py-3 text-muted">
                          {row.verified_at ? new Date(row.verified_at).toLocaleDateString() : "—"}
                        </td>

                        {/* Actions */}
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            {/* View DNS records */}
                            <button
                              id={`view-dns-${row.id}`}
                              onClick={() => handleViewDns(row)}
                              disabled={loadingDns[row.id]}
                              className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-foreground hover:text-foreground disabled:opacity-50"
                            >
                              {loadingDns[row.id] ? "…" : "View DNS"}
                            </button>

                            {!row.verified && (
                              <button
                                id={`verify-domain-${row.id}`}
                                onClick={() => handleVerify(row.id)}
                                disabled={verifying[row.id]}
                                className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark disabled:opacity-50"
                              >
                                {verifying[row.id] ? "Checking..." : "Check DNS"}
                              </button>
                            )}
                            <button
                              id={`delete-domain-${row.id}`}
                              onClick={() => handleDelete(row.id)}
                              disabled={deleting[row.id]}
                              className="h-7 rounded-full border border-red-200 px-3 text-xs font-semibold text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                            >
                              {deleting[row.id] ? "..." : "Remove"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline verify result below the row */}
                      {verifyResult[row.id]?.message && (
                        <tr className="border-b border-border/30">
                          <td colSpan={5} className="px-2 pb-3">
                            <p className={`rounded-xl px-4 py-2 text-xs ${
                              verifyResult[row.id].ok
                                ? "bg-emerald-50 text-emerald-800"
                                : "bg-amber-50 text-amber-800"
                            }`}>
                              {verifyResult[row.id].message}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-8 text-center text-muted" colSpan={5}>
                      No domains yet.{" "}
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="text-accent-dark font-semibold hover:underline underline-offset-2"
                      >
                        Add your first sending domain →
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* ── DNS Records Modal ─────────────────────────────────────────────────── */}
      {dnsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setDnsModal(null); }}
        >
          <div className="w-full max-w-2xl rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-xl">DNS Records</h2>
                <p className="text-sm text-muted font-mono mt-0.5">🌐 {dnsModal.domain.domain}</p>
              </div>
              <button
                onClick={() => setDnsModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60">
                    <th className="px-3 py-2 text-left font-semibold text-muted w-16">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted">Host</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dnsModal.records.map((rec, i) => (
                    <tr key={i} className="hover:bg-surface-muted/30 transition-colors">
                      <td className="px-3 py-2.5 align-top">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${
                          rec.type === "CNAME" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                        }`}>
                          {rec.type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-start gap-2">
                          <code className="break-all text-foreground leading-relaxed flex-1">{rec.host}</code>
                          <button
                            onClick={() => copyField(`m-${i}-host`, rec.host)}
                            className="shrink-0 mt-0.5 h-5 rounded border border-border px-1.5 text-[10px] font-semibold text-muted transition hover:bg-surface-muted"
                          >
                            {copied[`m-${i}-host`] ? "✓" : "Copy"}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-start gap-2">
                          <code className="break-all text-foreground leading-relaxed flex-1">{rec.value}</code>
                          <button
                            onClick={() => copyField(`m-${i}-value`, rec.value)}
                            className="shrink-0 mt-0.5 h-5 rounded border border-border px-1.5 text-[10px] font-semibold text-muted transition hover:bg-surface-muted"
                          >
                            {copied[`m-${i}-value`] ? "✓" : "Copy"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-muted">
              These records must be published in your DNS provider. Once all 5 are live, click <strong>Check DNS</strong> on the table to verify.
            </p>
          </div>
        </div>
      )}

      {/* ── Add Domain Modal ─────────────────────────────────────────────────── */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false); }}
        >
          <div className="w-full max-w-lg rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Add a sending domain</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <DomainSetupFlow
              token={token!}
              compact
              onComplete={handleSetupComplete}
              onCancel={() => setShowAddModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
