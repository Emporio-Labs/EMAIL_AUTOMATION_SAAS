"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

// -- Types ----------------------------------------------------------------------

type SendingAddress = {
  id: string;
  address: string;
  label: string | null;
  domain_id: string;
  created_at: string;
};

type AddressesResponse = { addresses: SendingAddress[] };

type CreateResponse = { address: SendingAddress };

type UpdateResponse = { address: SendingAddress };

// -- Main Page ------------------------------------------------------------------

export default function SendingAddressesPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<SendingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ address: "", label: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal
  const [editing, setEditing] = useState<SendingAddress | null>(null);
  const [editForm, setEditForm] = useState({ address: "", label: "" });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Per-row delete state
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  function getDomain(address: string) {
    return address.split("@")[1] ?? "-";
  }

  function loadAddresses() {
    if (!token) return;
    setLoading(true);
    apiFetch<AddressesResponse>("/v1/sending-addresses", token)
      .then((res) => { setItems(res.addresses); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load sending addresses"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadAddresses(); }, [token]);

  function openCreate() {
    setCreateForm({ address: "", label: "" });
    setCreateError(null);
    setShowCreateModal(true);
  }

  function openEdit(row: SendingAddress) {
    setEditing(row);
    setEditForm({ address: row.address, label: row.label ?? "" });
    setEditError(null);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setCreating(true);
    setCreateError(null);

    try {
      const res = await apiFetch<CreateResponse>("/v1/sending-addresses", token, {
        method: "POST",
        body: JSON.stringify({
          address: createForm.address,
          label: createForm.label || undefined,
        }),
      });
      setItems((prev) => [res.address, ...prev]);
      setShowCreateModal(false);
      setCreateForm({ address: "", label: "" });
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to add address");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !editing) return;
    setSaving(true);
    setEditError(null);

    try {
      const res = await apiFetch<UpdateResponse>(`/v1/sending-addresses/${editing.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          address: editForm.address,
          label: editForm.label,
        }),
      });
      setItems((prev) => prev.map((row) => (row.id === res.address.id ? res.address : row)));
      setEditing(null);
    } catch (err: any) {
      setEditError(err?.message ?? "Failed to update address");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Remove this sending address?")) return;
    setDeleting((p) => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/v1/sending-addresses/${id}`, token, { method: "DELETE" });
      setItems((p) => p.filter((row) => row.id !== id));
    } catch (err: any) {
      alert(err?.message ?? "Failed to delete address");
    } finally {
      setDeleting((p) => ({ ...p, [id]: false }));
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Sending addresses" subtitle="Approve specific From addresses for your tenant." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-2xl">Approved addresses</h3>
              <p className="text-xs text-muted mt-0.5">{items.length} addresses</p>
            </div>
            <button
              id="add-sending-address-btn"
              onClick={openCreate}
              className="h-9 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:bg-[#2a2a2a] active:scale-95"
            >
              + Add address
            </button>
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-surface-muted/50 px-5 py-4 text-sm text-muted leading-relaxed">
            Add the exact addresses your team is allowed to send from. Only verified domains are accepted.
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Address</th>
                  <th className="px-2 py-3 text-left">Label</th>
                  <th className="px-2 py-3 text-left">Domain</th>
                  <th className="px-2 py-3 text-left">Created</th>
                  <th className="px-2 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2 py-4 text-muted" colSpan={5}>Loading addresses...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-4 text-red-600" colSpan={5}>{error}</td></tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60 transition-colors hover:bg-surface-muted/40">
                      <td className="px-2 py-3 text-foreground font-medium font-mono">{row.address}</td>
                      <td className="px-2 py-3 text-muted">{row.label ?? "-"}</td>
                      <td className="px-2 py-3 text-muted">{getDomain(row.address)}</td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEdit(row)}
                            className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-foreground hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(row.id)}
                            disabled={deleting[row.id]}
                            className="h-7 rounded-full border border-red-200 px-3 text-xs font-semibold text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            {deleting[row.id] ? "..." : "Remove"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-8 text-center text-muted" colSpan={5}>
                      No sending addresses yet.{" "}
                      <button
                        onClick={openCreate}
                        className="text-accent-dark font-semibold hover:underline underline-offset-2"
                      >
                        Add your first address
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* -- Add Address Modal ------------------------------------------- */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Add a sending address</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleCreate}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Address *
                <input
                  id="sending-address-input"
                  type="email"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="e.g. hello@fitflix.in"
                  value={createForm.address}
                  onChange={(e) => setCreateForm({ ...createForm, address: e.target.value })}
                  required
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Label
                <input
                  id="sending-address-label-input"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="Optional label"
                  value={createForm.label}
                  onChange={(e) => setCreateForm({ ...createForm, label: e.target.value })}
                />
              </label>

              {createError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{createError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  id="add-sending-address-submit"
                  type="submit"
                  disabled={creating}
                  className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-60"
                >
                  {creating ? "Adding..." : "Add address"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* -- Edit Address Modal ------------------------------------------ */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Edit sending address</h2>
              <button
                onClick={() => setEditing(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleUpdate}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Address *
                <input
                  id="sending-address-edit-input"
                  type="email"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  required
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Label
                <input
                  id="sending-address-edit-label-input"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={editForm.label}
                  onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                />
              </label>

              {editError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{editError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  id="save-sending-address-submit"
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
