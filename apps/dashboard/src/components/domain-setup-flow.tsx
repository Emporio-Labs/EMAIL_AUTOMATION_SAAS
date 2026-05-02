"use client";

/**
 * DomainSetupFlow
 *
 * Reusable 3-step domain verification flow used in:
 *   1. OnboardingWizard  — full-screen, post-signup
 *   2. Domains page modal — inline, when adding a new domain
 *
 * Props:
 *   token       — auth bearer token
 *   onComplete  — called when domain verified OR user skips
 *   onCancel    — called when user cancels (modal only; omit in wizard)
 *   compact     — if true, uses compact sizing for modal context
 */

import { useState } from "react";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DnsRecord = {
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  description: string;
};

export type DomainRow = {
  id: string;
  domain: string;
  verified: boolean;
  dkim_tokens: string[];
  created_at: string;
  verified_at: string | null;
};

type AddDomainResponse = { domain: DomainRow; dnsRecords: DnsRecord[] };
type VerifyResponse = { verified: boolean; message?: string; domain?: DomainRow };

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  token: string;
  onComplete: (domain: DomainRow) => void;
  onCancel?: () => void;
  compact?: boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DomainSetupFlow({ token, onComplete, onCancel, compact = false }: Props) {
  const [step, setStep] = useState<"input" | "dns" | "verify">("input");

  const [domainInput, setDomainInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const [domainRow, setDomainRow] = useState<DomainRow | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verifyOk, setVerifyOk] = useState(false);

  // ── Step 1: register domain with SES ─────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInputError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<AddDomainResponse>("/v1/domains", token, {
        method: "POST",
        body: JSON.stringify({ domain: domainInput.trim().toLowerCase() }),
      });
      setDomainRow(res.domain);
      setDnsRecords(res.dnsRecords);
      setStep("dns");
    } catch (err: any) {
      setInputError(err?.message ?? "Failed to register domain");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step 3: poll SES for DKIM verification ────────────────────────────────

  async function handleVerify() {
    if (!domainRow) return;
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const res = await apiFetch<VerifyResponse>(`/v1/domains/${domainRow.id}/verify`, token);
      if (res.verified) {
        setVerifyOk(true);
        setVerifyMsg("✅ Domain verified! You can now send emails from this domain.");
        setTimeout(() => onComplete(res.domain ?? domainRow), 1500);
      } else {
        setVerifyOk(false);
        setVerifyMsg(res.message ?? "DNS not yet detected. Wait for propagation and try again.");
      }
    } catch (err: any) {
      setVerifyOk(false);
      setVerifyMsg(err?.message ?? "Verification check failed");
    } finally {
      setVerifying(false);
    }
  }

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied((p) => ({ ...p, [key]: true }));
    setTimeout(() => setCopied((p) => ({ ...p, [key]: false })), 2000);
  }

  // ── Step pill labels ──────────────────────────────────────────────────────

  const steps = ["Add domain", "DNS records", "Verify"];
  const stepIdx = step === "input" ? 0 : step === "dns" ? 1 : 2;

  // ── Sizing helpers ────────────────────────────────────────────────────────

  const h = compact ? "h-10" : "h-12";
  const titleClass = compact ? "font-display text-xl" : "font-display text-2xl";
  const cardPad = compact ? "px-6 py-6" : "px-8 py-8";

  return (
    <div className="flex flex-col gap-5 w-full">

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all ${
                i < stepIdx
                  ? "bg-emerald-500 text-white"
                  : i === stepIdx
                  ? "bg-foreground text-background"
                  : "bg-border text-muted"
              }`}
            >
              {i < stepIdx ? "✓" : i + 1}
            </div>
            <span className={`text-xs font-medium ${i === stepIdx ? "text-foreground" : "text-muted"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Domain input ────────────────────────────────────────────── */}
      {step === "input" && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <h3 className={`${titleClass} mb-1`}>Enter your sending domain</h3>
            <p className="text-sm text-muted">
              Use a subdomain like{" "}
              <code className="bg-surface-muted rounded px-1 text-xs">mail.yourcompany.com</code>{" "}
              for best deliverability.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Domain
            <input
              id="domain-setup-input"
              className={`${h} rounded-xl border border-border bg-surface-muted px-4 font-mono text-foreground outline-none focus:border-accent`}
              placeholder="mail.yourcompany.com"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              required
              autoFocus
              pattern="^[a-zA-Z0-9]([a-zA-Z0-9\-\.]+)\.[a-zA-Z]{2,}$"
              title="Enter a valid domain, e.g. mail.example.com"
            />
          </label>

          {inputError && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              {inputError}
            </div>
          )}

          <div className="flex gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className={`flex-1 ${h} rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted`}
              >
                Cancel
              </button>
            )}
            <button
              id="domain-setup-submit"
              type="submit"
              disabled={submitting}
              className={`flex-1 ${h} rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60`}
            >
              {submitting ? "Registering with SES..." : "Continue →"}
            </button>
          </div>
        </form>
      )}

      {/* ── Step 2: DNS records ──────────────────────────────────────────────── */}
      {step === "dns" && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className={`${titleClass} mb-1`}>Publish these DNS records</h3>
            <p className="text-sm text-muted">
              Add all <strong>5 records</strong> in your DNS provider (Cloudflare, GoDaddy, Route53…).
              Propagation takes <strong>5 min – 48 hrs</strong>.
            </p>
          </div>

          {/* Domain badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-muted px-4 py-1.5 text-sm font-mono text-foreground self-start">
            🌐 {domainRow?.domain}
          </div>

          {/* DNS Records Table */}
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
                {dnsRecords.map((rec, i) => (
                  <tr key={i} className="hover:bg-surface-muted/30 transition-colors">
                    {/* Type */}
                    <td className="px-3 py-2.5 align-top">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${
                        rec.type === "CNAME"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                      }`}>
                        {rec.type}
                      </span>
                    </td>

                    {/* Host */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        <code className="break-all text-foreground leading-relaxed flex-1">{rec.host}</code>
                        <button
                          onClick={() => copy(`${i}-host`, rec.host)}
                          className="shrink-0 mt-0.5 h-5 rounded border border-border px-1.5 text-[10px] font-semibold text-muted transition hover:bg-surface-muted"
                        >
                          {copied[`${i}-host`] ? "✓" : "Copy"}
                        </button>
                      </div>
                    </td>

                    {/* Value */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        <code className="break-all text-foreground leading-relaxed flex-1">{rec.value}</code>
                        <button
                          onClick={() => copy(`${i}-value`, rec.value)}
                          className="shrink-0 mt-0.5 h-5 rounded border border-border px-1.5 text-[10px] font-semibold text-muted transition hover:bg-surface-muted"
                        >
                          {copied[`${i}-value`] ? "✓" : "Copy"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800">
            ⏳ After adding all 5 records, click <strong>I've added the records</strong>. DNS propagation can take a few minutes.
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep("input")}
              className={`${h} rounded-full border border-border px-5 text-sm font-semibold text-muted transition hover:bg-surface-muted`}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep("verify")}
              className={`flex-1 ${h} rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80`}
            >
              I've added the records →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Verify ───────────────────────────────────────────────────── */}
      {step === "verify" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-2xl">
            🔍
          </div>
          <div>
            <h3 className={`${titleClass} mb-1`}>Verify your domain</h3>
            <p className="text-sm text-muted">
              Checking SES for DKIM records on{" "}
              <code className="bg-surface-muted rounded px-1 text-xs">{domainRow?.domain}</code>.
            </p>
          </div>

          {verifyMsg && (
            <div className={`w-full rounded-xl px-4 py-3 text-sm text-left ${
              verifyOk
                ? "bg-emerald-50 border border-emerald-100 text-emerald-800"
                : "bg-amber-50 border border-amber-100 text-amber-800"
            }`}>
              {verifyMsg}
            </div>
          )}

          <div className="w-full rounded-2xl border border-border bg-surface-muted/40 px-4 py-3 text-xs text-muted text-left">
            ⏱ <strong>DNS propagation takes 5 min – 48 hours.</strong> The background job checks
            every 10 minutes automatically. Come back and refresh this page once you've published
            the records and DNS has propagated.
          </div>

          <div className="flex flex-col gap-2 w-full">
            <button
              id="domain-setup-check-dns"
              onClick={handleVerify}
              disabled={verifying || verifyOk}
              className={`w-full ${h} rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60`}
            >
              {verifying ? "Checking SES..." : verifyOk ? "Verified ✓" : "Check DNS now"}
            </button>
          </div>

          <button
            onClick={() => setStep("dns")}
            className="text-xs text-muted hover:underline underline-offset-2"
          >
            ← Show DNS records again
          </button>
        </div>
      )}
    </div>
  );
}
