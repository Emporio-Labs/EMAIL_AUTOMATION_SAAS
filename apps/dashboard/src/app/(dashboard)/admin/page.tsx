"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { apiFetch } from "@/lib/api";

type GlobalStats = {
  totalTenants: number;
  totalBetaUsers: number;
  emailStats: {
    queued: number;
    delivered: number;
    failed: number;
    total: number;
  };
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'beta' | 'starter' | 'growth' | 'scale';
  rate_limit: number;
  monthly_email_limit: number;
  monthly_email_count: number;
  last_billing_reset: string;
  is_suspended: boolean;
  created_at: string;
  max_domains: number | null;
  max_sending_addresses: number | null;
  max_recipients_per_send: number | null;
  can_send_marketing: boolean | null;
  can_use_webhooks: boolean | null;
  can_track_opens: boolean | null;
  can_track_clicks: boolean | null;
  force_sandbox: boolean | null;
  trial_ends_at: string | null;
  internal_notes: string | null;
};

type BetaUser = {
  email: string;
  invited_at: string;
};

export default function AdminPage() {
  const { token, isAdmin, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'stats' | 'tenants' | 'beta'>('stats');
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [betaUsers, setBetaUsers] = useState<BetaUser[]>([]);
  
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingBeta, setLoadingBeta] = useState(false);
  
  const [statsError, setStatsError] = useState<string | null>(null);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [betaError, setBetaError] = useState<string | null>(null);

  // Beta invitation form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Tenant editing state
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    plan: Tenant['plan'];
    rate_limit: number;
    monthly_email_limit: number;
    is_suspended: boolean;
    max_domains: number | null;
    max_sending_addresses: number | null;
    max_recipients_per_send: number | null;
    can_send_marketing: boolean | null;
    can_use_webhooks: boolean | null;
    can_track_opens: boolean | null;
    can_track_clicks: boolean | null;
    force_sandbox: boolean | null;
    trial_ends_at: string | null;
    internal_notes: string | null;
  } | null>(null);
  const [updatingTenant, setUpdatingTenant] = useState(false);

  // Auth Guard
  useEffect(() => {
    if (token && !isAdmin) {
      window.location.href = "/overview";
    }
  }, [token, isAdmin]);

  // Load stats
  useEffect(() => {
    if (!token || !isAdmin) return;
    loadStats();
  }, [token, isAdmin]);

  // Load active tab data
  useEffect(() => {
    if (!token || !isAdmin) return;
    if (activeTab === 'tenants') {
      loadTenants();
    } else if (activeTab === 'beta') {
      loadBetaUsers();
    }
  }, [activeTab, token, isAdmin]);

  async function loadStats() {
    setLoadingStats(true);
    setStatsError(null);
    try {
      const res = await apiFetch<GlobalStats>("/v1/admin/stats", token);
      setStats(res);
    } catch (err: any) {
      setStatsError(err?.message ?? "Failed to load global statistics");
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadTenants() {
    setLoadingTenants(true);
    setTenantsError(null);
    try {
      const res = await apiFetch<{ tenants: Tenant[] }>("/v1/admin/tenants", token);
      setTenants(res.tenants ?? []);
    } catch (err: any) {
      setTenantsError(err?.message ?? "Failed to load tenants list");
    } finally {
      setLoadingTenants(false);
    }
  }

  async function loadBetaUsers() {
    setLoadingBeta(true);
    setBetaError(null);
    try {
      const res = await apiFetch<{ betaUsers: BetaUser[] }>("/v1/admin/beta-users", token);
      setBetaUsers(res.betaUsers ?? []);
    } catch (err: any) {
      setBetaError(err?.message ?? "Failed to load beta whitelist");
    } finally {
      setLoadingBeta(false);
    }
  }

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || inviting || !inviteEmail) return;
    setInviting(true);
    setBetaError(null);
    setInviteSuccess(null);

    try {
      await apiFetch("/v1/admin/beta-users", token, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      setInviteSuccess(`Successfully whitelisted and sent dogfood invite email to: ${inviteEmail}`);
      setInviteEmail("");
      await loadBetaUsers();
      await loadStats(); // Update totals
    } catch (err: any) {
      setBetaError(err?.message ?? "Failed to invite user");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveBeta(email: string) {
    if (!token || !window.confirm(`Are you sure you want to remove ${email} from the beta whitelist?`)) return;
    try {
      await apiFetch(`/v1/admin/beta-users/${encodeURIComponent(email)}`, token, {
        method: "DELETE",
      });
      await loadBetaUsers();
      await loadStats(); // Update totals
    } catch (err: any) {
      alert(err?.message ?? "Failed to remove user");
    }
  }

  function startEditTenant(tenant: Tenant) {
    setEditingTenantId(tenant.id);
    setEditForm({
      plan: tenant.plan,
      rate_limit: tenant.rate_limit,
      monthly_email_limit: tenant.monthly_email_limit,
      is_suspended: tenant.is_suspended,
      max_domains: tenant.max_domains,
      max_sending_addresses: tenant.max_sending_addresses,
      max_recipients_per_send: tenant.max_recipients_per_send,
      can_send_marketing: tenant.can_send_marketing,
      can_use_webhooks: tenant.can_use_webhooks,
      can_track_opens: tenant.can_track_opens,
      can_track_clicks: tenant.can_track_clicks,
      force_sandbox: tenant.force_sandbox,
      trial_ends_at: tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toISOString().split('T')[0] : null,
      internal_notes: tenant.internal_notes,
    });
  }

  async function handleSaveTenant(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editingTenantId || !editForm || updatingTenant) return;
    setUpdatingTenant(true);

    try {
      await apiFetch(`/v1/admin/tenants/${editingTenantId}`, token, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      setEditingTenantId(null);
      setEditForm(null);
      await loadTenants();
    } catch (err: any) {
      alert(err?.message ?? "Failed to update tenant settings");
    } finally {
      setUpdatingTenant(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted">
        Verifying administrator credentials...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Admin Control Center" subtitle="Manage system-wide workspaces, beta whitelisting, and limits." />
      
      <main className="flex-1 flex flex-col gap-6 px-6 py-8 max-w-7xl w-full mx-auto fade-in">
        
        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-border pb-1">
          <button
            onClick={() => setActiveTab('stats')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition ${
              activeTab === 'stats'
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            📊 Platform Stats
          </button>
          <button
            onClick={() => setActiveTab('tenants')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition ${
              activeTab === 'tenants'
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            🏢 Workspaces
          </button>
          <button
            onClick={() => setActiveTab('beta')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition ${
              activeTab === 'beta'
                ? "border-foreground text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            🔑 Beta Invites
          </button>
        </div>

        {/* Tab Content: Stats */}
        {activeTab === 'stats' && (
          <div className="flex flex-col gap-6">
            {loadingStats ? (
              <div className="text-sm text-muted">Loading platform statistics...</div>
            ) : statsError ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-800">{statsError}</div>
            ) : stats ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Tenants & Beta */}
                <div className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow flex flex-col justify-between">
                  <div>
                    <span className="text-2xl">🏢</span>
                    <h3 className="text-sm font-semibold text-muted mt-2">Active Workspaces</h3>
                  </div>
                  <p className="font-display text-4xl text-foreground mt-4">{stats.totalTenants}</p>
                </div>

                <div className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow flex flex-col justify-between">
                  <div>
                    <span className="text-2xl">🔑</span>
                    <h3 className="text-sm font-semibold text-muted mt-2">Beta Whitelisted</h3>
                  </div>
                  <p className="font-display text-4xl text-foreground mt-4">{stats.totalBetaUsers}</p>
                </div>

                {/* Email Delivery */}
                <div className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow md:col-span-3">
                  <h3 className="text-sm font-semibold text-muted">Overall Email Processing Volume</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                    <div className="bg-surface-muted rounded-2xl px-4 py-4 border border-border">
                      <p className="text-xs text-muted font-medium">Total Handled</p>
                      <p className="font-display text-2xl text-foreground mt-2">{stats.emailStats.total}</p>
                    </div>
                    <div className="bg-surface-muted rounded-2xl px-4 py-4 border border-border">
                      <p className="text-xs text-muted font-medium">Delivered</p>
                      <p className="font-display text-2xl text-emerald-600 mt-2">{stats.emailStats.delivered}</p>
                    </div>
                    <div className="bg-surface-muted rounded-2xl px-4 py-4 border border-border">
                      <p className="text-xs text-muted font-medium">Queued (In SQS)</p>
                      <p className="font-display text-2xl text-amber-600 mt-2">{stats.emailStats.queued}</p>
                    </div>
                    <div className="bg-surface-muted rounded-2xl px-4 py-4 border border-border">
                      <p className="text-xs text-muted font-medium">Failed / Bounced</p>
                      <p className="font-display text-2xl text-red-600 mt-2">{stats.emailStats.failed}</p>
                    </div>
                  </div>
                </div>

              </div>
            ) : null}
          </div>
        )}

        {/* Tab Content: Tenants */}
        {activeTab === 'tenants' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-foreground">Registered Workspaces</h2>
              <button 
                onClick={loadTenants} 
                className="text-xs font-semibold text-accent-dark hover:underline"
              >
                Refresh List ↻
              </button>
            </div>

            {loadingTenants ? (
              <div className="text-sm text-muted">Loading workspace parameters...</div>
            ) : tenantsError ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-800">{tenantsError}</div>
            ) : (
              <div className="overflow-x-auto rounded-3xl border border-border bg-surface card-shadow">
                <table className="min-w-full divide-y divide-border text-left text-sm text-foreground">
                  <thead className="bg-surface-muted text-xs font-semibold uppercase text-muted tracking-wider">
                    <tr>
                      <th className="px-6 py-4">Workspace</th>
                      <th className="px-6 py-4">Slug</th>
                      <th className="px-6 py-4">Plan</th>
                      <th className="px-6 py-4">Limits (EPS / Mo)</th>
                      <th className="px-6 py-4">Sent This Month</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-medium">
                    {tenants.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-muted">No workspaces registered yet.</td>
                      </tr>
                    ) : (
                      tenants.map((tenant) => (
                        <tr key={tenant.id} className="hover:bg-surface-muted/50">
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-foreground font-semibold">{tenant.name}</p>
                              <p className="text-[10px] text-muted font-mono mt-0.5">{tenant.id}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-muted font-mono">{tenant.slug}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold capitalize ${
                              tenant.plan === 'scale'
                                ? "bg-purple-50 text-purple-700 border border-purple-200"
                                : tenant.plan === 'growth'
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : tenant.plan === 'starter'
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : tenant.plan === 'beta'
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-gray-50 text-gray-700 border border-gray-200"
                            }`}>
                              {tenant.plan}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-foreground">{tenant.rate_limit} / min</p>
                              <p className="text-xs text-muted">{tenant.monthly_email_limit.toLocaleString()} / month</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className={tenant.monthly_email_count >= tenant.monthly_email_limit ? "text-red-600 font-bold" : "text-foreground"}>
                                {tenant.monthly_email_count.toLocaleString()}
                              </span>
                              <span className="text-muted text-xs">({Math.min(100, Math.round((tenant.monthly_email_count / tenant.monthly_email_limit) * 100))}% used)</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {tenant.is_suspended ? (
                              <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">Suspended</span>
                            ) : (
                              <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Active</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => startEditTenant(tenant)}
                              className="text-xs font-semibold text-accent-dark hover:underline"
                            >
                              Edit Settings
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Beta Whitelist */}
        {activeTab === 'beta' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Whitelist and Invite Form */}
            <div className="md:col-span-1 flex flex-col gap-6">
              <div className="rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
                <h2 className="font-display text-xl text-foreground">Invite Beta User</h2>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Adding an email grants registration permission. It automatically fires a custom welcome invitation using SwayamMail's SQS/SES pipeline (dogfooding).
                </p>

                <form onSubmit={handleInviteSubmit} className="flex flex-col gap-4 mt-6">
                  <label className="flex flex-col gap-2 text-sm text-muted">
                    Email Address
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="founder@company.com"
                      className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                    />
                  </label>

                  {betaError && (
                    <p className="text-xs text-red-600 font-semibold">{betaError}</p>
                  )}
                  {inviteSuccess && (
                    <p className="text-xs text-emerald-600 font-semibold leading-relaxed">{inviteSuccess}</p>
                  )}

                  <button
                    type="submit"
                    disabled={inviting}
                    className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-black hover:text-white disabled:opacity-60"
                  >
                    {inviting ? "Inviting via SwayamMail..." : "Whitelist & Send Invite"}
                  </button>
                </form>
              </div>
            </div>

            {/* Whitelist Directory */}
            <div className="md:col-span-2 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl text-foreground">Whitelist Directory</h2>
                <button 
                  onClick={loadBetaUsers} 
                  className="text-xs font-semibold text-accent-dark hover:underline"
                >
                  Refresh Directory ↻
                </button>
              </div>

              {loadingBeta ? (
                <div className="text-sm text-muted">Loading whitelisted accounts...</div>
              ) : (
                <div className="rounded-3xl border border-border bg-surface card-shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-border text-left text-sm text-foreground">
                    <thead className="bg-surface-muted text-xs font-semibold uppercase text-muted tracking-wider">
                      <tr>
                        <th className="px-6 py-4">Whitelisted Email</th>
                        <th className="px-6 py-4">Date Invited</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {betaUsers.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-6 py-8 text-center text-muted">No beta users invited yet.</td>
                        </tr>
                      ) : (
                        betaUsers.map((user) => (
                          <tr key={user.email} className="hover:bg-surface-muted/50 font-medium">
                            <td className="px-6 py-4 text-foreground font-semibold">{user.email}</td>
                            <td className="px-6 py-4 text-muted text-xs font-mono">
                              {new Date(user.invited_at).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => handleRemoveBeta(user.email)}
                                className="text-xs font-semibold text-red-600 hover:underline"
                              >
                                Revoke Access
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

        {editingTenantId && editForm && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <form onSubmit={handleSaveTenant} className="bg-surface border border-border rounded-3xl p-6 max-w-xl w-full card-shadow max-h-[90vh] overflow-y-auto flex flex-col gap-4 fade-in">
              <div className="flex justify-between items-center border-b border-border pb-3">
                <h3 className="text-lg font-bold text-foreground">Adjust Settings for {tenants.find(t => t.id === editingTenantId)?.name}</h3>
                <button type="button" onClick={() => { setEditingTenantId(null); setEditForm(null); }} className="text-muted hover:text-foreground text-sm font-semibold">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Plan Type
                  <select 
                    value={editForm.plan}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, plan: e.target.value as any} : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="free">Free</option>
                    <option value="beta">Beta</option>
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="scale">Scale</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Rate Limit (emails/min)
                  <input 
                    type="number"
                    value={editForm.rate_limit}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, rate_limit: parseInt(e.target.value) || 1} : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                    min={1}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Monthly Volume Limit
                  <input 
                    type="number"
                    value={editForm.monthly_email_limit}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, monthly_email_limit: parseInt(e.target.value) || 0} : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                    min={0}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Max Domains Override
                  <input 
                    type="number"
                    value={editForm.max_domains ?? ""}
                    placeholder="Using plan default"
                    onChange={(e) => setEditForm(prev => prev ? {...prev, max_domains: e.target.value === "" ? null : parseInt(e.target.value) } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                    min={0}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Max Sending Addresses Override
                  <input 
                    type="number"
                    value={editForm.max_sending_addresses ?? ""}
                    placeholder="Using plan default"
                    onChange={(e) => setEditForm(prev => prev ? {...prev, max_sending_addresses: e.target.value === "" ? null : parseInt(e.target.value) } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                    min={0}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Max Recipients Per Send Override
                  <input 
                    type="number"
                    value={editForm.max_recipients_per_send ?? ""}
                    placeholder="Using plan default"
                    onChange={(e) => setEditForm(prev => prev ? {...prev, max_recipients_per_send: e.target.value === "" ? null : parseInt(e.target.value) } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                    min={0}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Can Send Marketing Override
                  <select 
                    value={editForm.can_send_marketing === null ? "null" : String(editForm.can_send_marketing)}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, can_send_marketing: e.target.value === "null" ? null : e.target.value === "true" } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="null">Using plan default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Can Use Webhooks Override
                  <select 
                    value={editForm.can_use_webhooks === null ? "null" : String(editForm.can_use_webhooks)}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, can_use_webhooks: e.target.value === "null" ? null : e.target.value === "true" } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="null">Using plan default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Can Track Opens Override
                  <select 
                    value={editForm.can_track_opens === null ? "null" : String(editForm.can_track_opens)}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, can_track_opens: e.target.value === "null" ? null : e.target.value === "true" } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="null">Using plan default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Can Track Clicks Override
                  <select 
                    value={editForm.can_track_clicks === null ? "null" : String(editForm.can_track_clicks)}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, can_track_clicks: e.target.value === "null" ? null : e.target.value === "true" } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="null">Using plan default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Force Sandbox Override
                  <select 
                    value={editForm.force_sandbox === null ? "null" : String(editForm.force_sandbox)}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, force_sandbox: e.target.value === "null" ? null : e.target.value === "true" } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  >
                    <option value="null">Using plan default</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                  Trial Ends At
                  <input 
                    type="date"
                    value={editForm.trial_ends_at ?? ""}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, trial_ends_at: e.target.value === "" ? null : e.target.value } : null)}
                    className="bg-surface-muted border border-border rounded-xl px-3 h-10 outline-none text-xs text-foreground"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-xs text-muted font-semibold">
                Internal Notes
                <textarea 
                  value={editForm.internal_notes ?? ""}
                  placeholder="Using plan default"
                  onChange={(e) => setEditForm(prev => prev ? {...prev, internal_notes: e.target.value === "" ? null : e.target.value} : null)}
                  className="bg-surface-muted border border-border rounded-xl p-3 h-20 outline-none text-xs text-foreground resize-none"
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-muted my-1 font-semibold">
                <input 
                  type="checkbox"
                  checked={editForm.is_suspended}
                  onChange={(e) => setEditForm(prev => prev ? {...prev, is_suspended: e.target.checked} : null)}
                  className="rounded border-border text-foreground focus:ring-0"
                />
                Suspend Account
              </label>

              <div className="flex gap-3 justify-end border-t border-border pt-4 mt-2">
                <button 
                  type="button" 
                  onClick={() => { setEditingTenantId(null); setEditForm(null); }}
                  className="px-4 h-10 border border-border rounded-full text-xs text-muted hover:bg-surface-muted transition font-semibold"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={updatingTenant}
                  className="px-5 h-10 bg-foreground text-background font-semibold rounded-full text-xs hover:bg-black hover:text-white transition disabled:opacity-60"
                >
                  {updatingTenant ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
