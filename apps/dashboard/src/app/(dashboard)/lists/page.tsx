"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

// ── Types ──────────────────────────────────────────────────────────────────────

type ListItem = {
  id: string;
  name: string;
  description: string | null;
  type: "marketing" | "contact";
  created_at: string;
};

type ListsResponse = { lists: ListItem[] };
type CreateListResponse = { list: ListItem };

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

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ListsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create list modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; description: string; type: "marketing" }>({
    name: "",
    description: "",
    type: "marketing",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Selected list detail panel
  const [selectedList, setSelectedList] = useState<ListItem | null>(null);

  function loadLists() {
    if (!token) return;
    setLoading(true);
    apiFetch<ListsResponse>("/v1/lists", token)
      .then((res) => { setItems(res.lists); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load lists"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadLists(); }, [token]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await apiFetch<CreateListResponse>("/v1/lists", token, {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || undefined,
          type: createForm.type,
        }),
      });
      setItems((prev) => [res.list, ...prev]);
      setSelectedList(res.list);
      setShowCreateModal(false);
      setCreateForm({ name: "", description: "", type: "marketing" });
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to create list");
    } finally {
      setCreating(false);
    }
  }

  function openCreate() {
    setCreateForm({ name: "", description: "", type: "marketing" });
    setCreateError(null);
    setShowCreateModal(true);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Lists" subtitle="Segmented audiences and saved cohorts." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-2xl">Audience lists</h3>
              <p className="text-xs text-muted mt-0.5">{items.length} lists</p>
            </div>
            <button
              id="create-list-btn"
              onClick={openCreate}
              className="h-9 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 active:scale-95"
            >
              + Create list
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">List</th>
                  <th className="px-2 py-3 text-left">Description</th>
                  <th className="px-2 py-3 text-left">Type</th>
                  <th className="px-2 py-3 text-left">Created</th>
                  <th className="px-2 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2 py-4 text-muted" colSpan={5}>Loading lists...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-4 text-red-600" colSpan={5}>{error}</td></tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-b border-border/60 transition-colors ${selectedList?.id === row.id ? "bg-accent-soft/40" : "hover:bg-surface-muted/60"}`}
                    >
                      <td className="px-2 py-3 text-foreground font-medium">{row.name}</td>
                      <td className="px-2 py-3 text-muted">{row.description ?? "—"}</td>
                      <td className="px-2 py-3 text-muted">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.type === "marketing" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {row.type === "marketing" ? "Marketing" : "Contact"}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-2 py-3">
                        <button
                          onClick={() => setSelectedList(row)}
                          className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark"
                        >
                          Manage contacts →
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-8 text-center text-muted" colSpan={5}>
                      No lists yet.{" "}
                      <button onClick={openCreate} className="text-accent-dark font-semibold hover:underline underline-offset-2">
                        Create your first list →
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* ── Create List Modal ─────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Create a list</h2>
              <button onClick={() => setShowCreateModal(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition" aria-label="Close">✕</button>
            </div>
            <form className="flex flex-col gap-4" onSubmit={handleCreate}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                List name *
                <input
                  id="list-name-input"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="e.g. Weekly Newsletter"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required autoFocus
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Description
                <input
                  id="list-description-input"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="Optional description"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                List type *
                <select
                  id="list-type-select"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={createForm.type}
                  onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as "marketing" })}
                >
                  <option value="marketing">Marketing</option>
                </select>
              </label>
              {createError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{createError}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted">Cancel</button>
                <button id="create-list-submit" type="submit" disabled={creating} className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60">
                  {creating ? "Creating..." : "Create list"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── List Detail Side Panel ────────────────────────────────────── */}
      {selectedList && (
        <ListDetailPanel
          list={selectedList}
          token={token}
          onClose={() => setSelectedList(null)}
        />
      )}
    </div>
  );
}

// ── List Detail Panel ──────────────────────────────────────────────────────────

function ListDetailPanel({
  list,
  token,
  onClose,
}: {
  list: ListItem;
  token: string | null;
  onClose: () => void;
}) {
  const [contacts, setContacts] = useState<ListContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add contacts form
  const [emailInput, setEmailInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  function loadContacts() {
    if (!token) return;
    setLoading(true);
    apiFetch<ListContactsResponse>(`/v1/lists/${list.id}/contacts`, token)
      .then((res) => { setContacts(res.contacts); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load contacts"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadContacts();
    setEmailInput("");
    setAddResult(null);
  }, [list.id]);

  async function handleAddContacts(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;

    const emails = emailInput
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    if (emails.length === 0) return;

    setAdding(true);
    setAddResult(null);

    try {
      const res = await apiFetch<{ added: number }>(`/v1/lists/${list.id}/contacts`, token, {
        method: "POST",
        body: JSON.stringify({ emails }),
      });
      setAddResult({ type: "success", message: `✅ Added ${res.added} contact${res.added !== 1 ? "s" : ""} to the list.` });
      setEmailInput("");
      loadContacts(); // Refresh list contacts
    } catch (err: any) {
      setAddResult({ type: "error", message: `❌ ${err?.message ?? "Failed to add contacts"}` });
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm fade-in" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-surface border-l border-border shadow-2xl flex flex-col fade-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border shrink-0">
          <div>
            <h2 className="font-display text-xl">{list.name}</h2>
            {list.description && <p className="text-xs text-muted mt-0.5">{list.description}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition text-lg"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Add contacts form */}
        <div className="px-6 py-5 border-b border-border shrink-0 bg-surface-muted/40">
          <h3 className="text-sm font-semibold text-foreground mb-3">Add contacts to this list</h3>
          <form onSubmit={handleAddContacts} className="flex flex-col gap-3">
            <textarea
              id="add-contacts-email-input"
              className="min-h-[80px] rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-accent resize-none"
              placeholder="Paste emails separated by commas:&#10;john@example.com, jane@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              required
            />
            {addResult && (
              <p className={`text-sm rounded-xl px-4 py-2 ${addResult.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                {addResult.message}
              </p>
            )}
            <button
              id="add-contacts-to-list-btn"
              type="submit"
              disabled={adding || !emailInput.trim()}
              className="h-10 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-50 active:scale-95"
            >
              {adding ? "Adding..." : "Add contacts"}
            </button>
          </form>
        </div>

        {/* Contacts list */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">
              Contacts in this list
            </h3>
            <span className="text-xs text-muted">{contacts.length} total</span>
          </div>

          {loading ? (
            <p className="text-sm text-muted">Loading contacts...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm text-muted">No contacts in this list yet.</p>
              <p className="text-xs text-muted mt-1">Paste emails above to add some.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {contacts.map((item) => (
                <div
                  key={item.contact_id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-dark uppercase">
                    {item.contacts.email[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.contacts.email}</p>
                    {(item.contacts.first_name || item.contacts.last_name) && (
                      <p className="text-xs text-muted">
                        {[item.contacts.first_name, item.contacts.last_name].filter(Boolean).join(" ")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
