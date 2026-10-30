"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

type Contact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  attributes?: Record<string, unknown> | null;
  created_at: string;
};

// "company: Acme" lines <-> { company: "Acme" }, for merge tags like {{company}}.
function parseFields(text: string): Record<string, string> | string {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const index = line.indexOf(":");
    const key = (index === -1 ? "" : line.slice(0, index)).trim();
    if (!/^[a-zA-Z_]\w{0,49}$/.test(key)) {
      return `"${line}" should look like field_name: value (letters, digits and _ in the name)`;
    }
    fields[key] = line.slice(index + 1).trim();
  }
  return fields;
}

function formatFields(attributes: Record<string, unknown> | null | undefined): string {
  const entries = Object.entries(attributes ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ") : "—";
}

type ContactsResponse = {
  contacts: Contact[];
};

type CreateContactResponse = {
  contact: Contact;
};

export default function ContactsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: "", firstName: "", lastName: "", fields: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function loadContacts() {
    if (!token) return;
    setLoading(true);
    apiFetch<ContactsResponse>("/v1/contacts", token)
      .then((response) => {
        setItems(response.contacts);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load contacts"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadContacts();
  }, [token]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    const attributes = parseFields(form.fields);
    if (typeof attributes === "string") {
      setCreateError(attributes);
      return;
    }
    setCreating(true);
    setCreateError(null);

    try {
      const result = await apiFetch<CreateContactResponse>("/v1/contacts", token, {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          attributes: Object.keys(attributes).length ? attributes : undefined,
        }),
      });
      setItems((prev) => [result.contact, ...prev]);
      setShowModal(false);
      setForm({ email: "", firstName: "", lastName: "", fields: "" });
    } catch (err: any) {
      setCreateError(err?.message ?? "Failed to add contact");
    } finally {
      setCreating(false);
    }
  }

  function openModal() {
    setForm({ email: "", firstName: "", lastName: "", fields: "" });
    setCreateError(null);
    setShowModal(true);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Contacts" subtitle="All recipients across your lists." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-2xl">All contacts</h3>
              <p className="text-xs text-muted mt-0.5">{items.length} contacts</p>
            </div>
            <button
              id="add-contact-btn"
              onClick={openModal}
              className="h-9 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 active:scale-95"
            >
              + Add contact
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Email</th>
                  <th className="px-2 py-3 text-left">First name</th>
                  <th className="px-2 py-3 text-left">Last name</th>
                  <th className="px-2 py-3 text-left">Custom fields</th>
                  <th className="px-2 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={5}>
                      Loading contacts...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="px-2 py-4 text-red-600" colSpan={5}>
                      {error}
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground font-medium">{row.email}</td>
                      <td className="px-2 py-3 text-muted">{row.first_name ?? "—"}</td>
                      <td className="px-2 py-3 text-muted">{row.last_name ?? "—"}</td>
                      <td className="px-2 py-3 text-muted max-w-xs truncate">{formatFields(row.attributes)}</td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-8 text-center text-muted" colSpan={5}>
                      No contacts yet.{" "}
                      <button
                        onClick={openModal}
                        className="text-accent-dark font-semibold hover:underline underline-offset-2"
                      >
                        Add your first contact →
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* ── Add Contact Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Add a contact</h2>
              <button
                onClick={() => setShowModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleCreate}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Email address *
                <input
                  id="contact-email-input"
                  type="email"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="e.g. john@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  autoFocus
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-sm text-muted">
                  <div className="flex items-baseline justify-between">
                    <span>First name</span>
                    <span className="text-xs text-muted">Optional</span>
                  </div>
                  <input
                    id="contact-firstname-input"
                    className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                    placeholder="John"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm text-muted">
                  <div className="flex items-baseline justify-between">
                    <span>Last name</span>
                    <span className="text-xs text-muted">Optional</span>
                  </div>
                  <input
                    id="contact-lastname-input"
                    className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm text-muted">
                <div className="flex items-baseline justify-between">
                  <span>Custom fields</span>
                  <span className="text-xs text-muted">Optional, one per line</span>
                </div>
                <textarea
                  id="contact-fields-input"
                  className="min-h-[80px] rounded-xl border border-border bg-surface-muted px-4 py-3 font-mono text-sm text-foreground outline-none focus:border-accent"
                  placeholder={"company: Acme Retail\nreport_url: https://..."}
                  value={form.fields}
                  onChange={(e) => setForm({ ...form, fields: e.target.value })}
                />
                <span className="text-xs">Use them in emails as {"{{company}}"}, {"{{report_url}}"} and so on.</span>
              </label>

              {createError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{createError}</p>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted"
                >
                  Cancel
                </button>
                <button
                  id="add-contact-submit"
                  type="submit"
                  disabled={creating}
                  className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                >
                  {creating ? "Adding..." : "Add contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
