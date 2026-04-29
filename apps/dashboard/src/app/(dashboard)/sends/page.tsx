"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";

// ── Types ──────────────────────────────────────────────────────────────────────

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

type SendsResponse = { page: number; limit: number; total: number; items: SendItem[] };

type ListItem = { id: string; name: string; description: string | null };
type Contact = { id: string; email: string; first_name: string | null; last_name: string | null };
type ListContact = { contact_id: string; contacts: Contact };

type Toast = { id: number; type: "success" | "error"; message: string };

type SendingAddress = {
  id: string;
  address: string;
  label: string | null;
  domain_id: string;
  created_at: string;
};

type SendingAddressesResponse = { addresses: SendingAddress[] };

let toastCounter = 0;
type RecipientTab = "lists" | "contacts" | "manual";

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SendsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<SendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", html: "" });
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [fromAddress, setFromAddress] = useState("");
  const [sendingAddresses, setSendingAddresses] = useState<SendingAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Recipients state — single shared Set
  const [recipientEmails, setRecipientEmails] = useState<Set<string>>(new Set());
  const [recipientTab, setRecipientTab] = useState<RecipientTab>("manual");

  // Data for lists / contacts tabs
  const [lists, setLists] = useState<ListItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Lists tab state
  const [selectedListId, setSelectedListId] = useState("");
  const [loadingListContacts, setLoadingListContacts] = useState(false);

  // Contacts tab state
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  // Manual tab state
  const [manualInput, setManualInput] = useState("");

  function addToast(type: Toast["type"], message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function addEmails(emails: string[]) {
    const normalized = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
    setRecipientEmails((prev) => new Set([...prev, ...normalized]));
  }

  function removeEmail(email: string) {
    setRecipientEmails((prev) => { const next = new Set(prev); next.delete(email); return next; });
  }

  function clearAll() { setRecipientEmails(new Set()); }

  // Load sends list
  function loadSends() {
    if (!token) return;
    setLoading(true);
    apiFetch<SendsResponse>("/v1/sends", token)
      .then((res) => { setItems(res.items); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load sends"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadSends(); }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoadingAddresses(true);
    apiFetch<SendingAddressesResponse>("/v1/sending-addresses", token)
      .then((res) => setSendingAddresses(res.addresses))
      .catch(() => {})
      .finally(() => setLoadingAddresses(false));
  }, [token]);

  // Load lists when "lists" tab is first opened
  useEffect(() => {
    if (recipientTab !== "lists" || !token || lists.length > 0) return;
    setLoadingLists(true);
    apiFetch<{ lists: ListItem[] }>("/v1/lists", token)
      .then((res) => setLists(res.lists))
      .catch(() => {})
      .finally(() => setLoadingLists(false));
  }, [recipientTab, token]);

  // Load contacts when "contacts" tab is first opened
  useEffect(() => {
    if (recipientTab !== "contacts" || !token || contacts.length > 0) return;
    setLoadingContacts(true);
    apiFetch<{ contacts: Contact[] }>("/v1/contacts", token)
      .then((res) => setContacts(res.contacts))
      .catch(() => {})
      .finally(() => setLoadingContacts(false));
  }, [recipientTab, token]);

  // Add all contacts from a selected list
  async function handleAddFromList() {
    if (!token || !selectedListId) return;
    setLoadingListContacts(true);
    try {
      const res = await apiFetch<{ contacts: ListContact[] }>(`/v1/lists/${selectedListId}/contacts`, token);
      const emails = res.contacts.map((c) => c.contacts.email);
      if (emails.length === 0) {
        addToast("error", "This list has no contacts yet.");
      } else {
        addEmails(emails);
        addToast("success", `✅ Added ${emails.length} contact${emails.length !== 1 ? "s" : ""} from list.`);
      }
    } catch {
      addToast("error", "Failed to load list contacts.");
    } finally {
      setLoadingListContacts(false);
    }
  }

  // Add selected contacts from contacts tab
  function handleAddSelectedContacts() {
    const emails = contacts
      .filter((c) => selectedContactIds.has(c.id))
      .map((c) => c.email);
    if (emails.length === 0) return;
    addEmails(emails);
    setSelectedContactIds(new Set());
    addToast("success", `✅ Added ${emails.length} contact${emails.length !== 1 ? "s" : ""}.`);
  }

  function toggleContact(id: string) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Add manual emails
  function handleAddManual() {
    const emails = manualInput.split(",").map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    addEmails(emails);
    setManualInput("");
  }

  // Filter contacts by search
  const filteredContacts = useMemo(() =>
    contacts.filter((c) =>
      c.email.toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.first_name ?? "").toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.last_name ?? "").toLowerCase().includes(contactSearch.toLowerCase())
    ), [contacts, contactSearch]);

  // Send emails
  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const toEmails = Array.from(recipientEmails);
    if (!fromAddress) {
      addToast("error", "Select a From address before sending.");
      return;
    }
    if (toEmails.length === 0) {
      addToast("error", "Add at least one recipient before sending.");
      return;
    }
    setSending(true);
    try {
      const result = await apiFetch<{ accepted: number }>("/v1/send", token, {
        method: "POST",
        body: JSON.stringify({ subject: form.subject, html: form.html, from: fromAddress, toEmails }),
      });
      addToast("success", `✅ ${result.accepted} email${result.accepted !== 1 ? "s" : ""} queued successfully!`);
      setForm({ subject: "", html: "" });
      setRecipientEmails(new Set());
      setTimeout(loadSends, 1500);
    } catch (err: any) {
      addToast("error", `❌ ${err?.message ?? "Failed to send emails."}`);
    } finally {
      setSending(false);
    }
  }

  const tabClasses = (active: boolean) =>
    `px-4 py-1.5 rounded-full text-xs font-semibold transition ${active ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Sends" subtitle="Trigger new sends and monitor delivery status." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr] fade-in">

          {/* ── Compose form ─────────────────────────────────── */}
          <div className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow flex flex-col gap-5">
            <div>
              <h2 className="font-display text-2xl text-foreground">Send a campaign</h2>
              <p className="mt-1 text-sm text-muted">Choose recipients from your lists, contacts, or paste emails manually.</p>
            </div>

            <form className="flex flex-col gap-5" onSubmit={handleSend}>

              {/* ── From address ───────────────────────── */}
              <label className="flex flex-col gap-2 text-sm text-muted">
                From address *
                <select
                  id="send-from-select"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  disabled={loadingAddresses || sendingAddresses.length === 0}
                  required
                >
                  <option value="">— Select a sending address —</option>
                  {sendingAddresses.map((addr) => (
                    <option key={addr.id} value={addr.address}>
                      {addr.label ? `${addr.label} — ${addr.address}` : addr.address}
                    </option>
                  ))}
                </select>
                {!loadingAddresses && sendingAddresses.length === 0 && (
                  <span className="text-xs text-muted">
                    No sending addresses yet. Manage them in{" "}
                    <Link className="text-accent-dark font-semibold hover:underline underline-offset-2" href="/sending-addresses">
                      Sending addresses
                    </Link>.
                  </span>
                )}
              </label>

              {/* ── Subject ────────────────────────────────── */}
              <label className="flex flex-col gap-2 text-sm text-muted">
                Subject *
                <input
                  id="send-subject-input"
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="Your email subject..."
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  required
                />
              </label>

              {/* ── Recipients picker ───────────────────────── */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Recipients *</span>
                  {recipientEmails.size > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-muted hover:text-red-500 transition">
                      Clear all ({recipientEmails.size})
                    </button>
                  )}
                </div>

                {/* Tab switcher */}
                <div className="flex gap-1 rounded-full border border-border bg-surface-muted p-1 w-fit">
                  <button type="button" className={tabClasses(recipientTab === "lists")} onClick={() => setRecipientTab("lists")}>From lists</button>
                  <button type="button" className={tabClasses(recipientTab === "contacts")} onClick={() => setRecipientTab("contacts")}>From contacts</button>
                  <button type="button" className={tabClasses(recipientTab === "manual")} onClick={() => setRecipientTab("manual")}>Manual</button>
                </div>

                {/* Lists tab */}
                {recipientTab === "lists" && (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
                    {loadingLists ? (
                      <p className="text-xs text-muted">Loading lists...</p>
                    ) : lists.length === 0 ? (
                      <p className="text-xs text-muted">No lists found. Create a list first.</p>
                    ) : (
                      <>
                        <select
                          id="send-list-select"
                          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
                          value={selectedListId}
                          onChange={(e) => setSelectedListId(e.target.value)}
                        >
                          <option value="">— Select a list —</option>
                          {lists.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          id="add-from-list-btn"
                          onClick={handleAddFromList}
                          disabled={!selectedListId || loadingListContacts}
                          className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-50"
                        >
                          {loadingListContacts ? "Loading..." : "Add all contacts from this list"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Contacts tab */}
                {recipientTab === "contacts" && (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
                    {loadingContacts ? (
                      <p className="text-xs text-muted">Loading contacts...</p>
                    ) : contacts.length === 0 ? (
                      <p className="text-xs text-muted">No contacts found. Add contacts first.</p>
                    ) : (
                      <>
                        <input
                          className="h-9 rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
                          placeholder="Search contacts..."
                          value={contactSearch}
                          onChange={(e) => setContactSearch(e.target.value)}
                        />
                        <div className="max-h-44 overflow-y-auto flex flex-col gap-1">
                          {filteredContacts.length === 0 ? (
                            <p className="text-xs text-muted py-2">No matches.</p>
                          ) : filteredContacts.map((c) => (
                            <label
                              key={c.id}
                              className={`flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition ${selectedContactIds.has(c.id) ? "bg-accent-soft/60" : "hover:bg-surface"}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedContactIds.has(c.id)}
                                onChange={() => toggleContact(c.id)}
                                className="accent-foreground"
                              />
                              <span className="text-xs text-foreground truncate">{c.email}</span>
                              {(c.first_name || c.last_name) && (
                                <span className="text-xs text-muted ml-auto shrink-0">
                                  {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          id="add-selected-contacts-btn"
                          onClick={handleAddSelectedContacts}
                          disabled={selectedContactIds.size === 0}
                          className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-50"
                        >
                          Add {selectedContactIds.size > 0 ? `${selectedContactIds.size} selected` : "selected contacts"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Manual tab */}
                {recipientTab === "manual" && (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
                    <textarea
                      id="send-manual-emails-input"
                      className="min-h-[72px] rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-accent resize-none"
                      placeholder="Paste comma-separated emails:&#10;john@example.com, jane@example.com, ..."
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                    />
                    <button
                      type="button"
                      id="add-manual-emails-btn"
                      onClick={handleAddManual}
                      disabled={!manualInput.trim()}
                      className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:bg-[#2a2a2a] disabled:opacity-50"
                    >
                      Add emails
                    </button>
                  </div>
                )}

                {/* Recipients tags */}
                {recipientEmails.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface-muted/60 px-3 py-2 max-h-28 overflow-y-auto">
                    {Array.from(recipientEmails).map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2.5 py-0.5 text-xs text-foreground"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() => removeEmail(email)}
                          className="text-muted hover:text-red-500 transition leading-none text-sm"
                          aria-label={`Remove ${email}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* ── HTML body ──────────────────────────────── */}
              <label className="flex flex-col gap-2 text-sm text-muted">
                HTML body *
                <textarea
                  id="send-html-input"
                  className="min-h-[140px] rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground outline-none focus:border-accent"
                  placeholder="<p>Welcome to SwayamMail...</p>"
                  value={form.html}
                  onChange={(e) => setForm({ ...form, html: e.target.value })}
                  required
                />
              </label>

              <button
                id="send-emails-btn"
                type="submit"
                disabled={sending || recipientEmails.size === 0}
                className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:bg-[#2a2a2a] active:scale-[0.98] disabled:opacity-60"
              >
                {sending
                  ? "Sending..."
                  : recipientEmails.size > 0
                  ? `Send to ${recipientEmails.size} recipient${recipientEmails.size !== 1 ? "s" : ""}`
                  : "Send emails"}
              </button>
            </form>
          </div>

          {/* ── Delivery snapshot ─────────────────────────── */}
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

            {/* Quick recipient summary */}
            {recipientEmails.size > 0 && (
              <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <p className="text-xs font-semibold text-emerald-800">
                  {recipientEmails.size} recipient{recipientEmails.size !== 1 ? "s" : ""} ready to send
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── Recent sends table ─────────────────────────── */}
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
                  <tr><td className="px-2 py-4 text-muted" colSpan={4}>Loading sends...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-4 text-red-600" colSpan={4}>{error}</td></tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.job_id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{row.to_email}</td>
                      <td className="px-2 py-3 text-muted">{row.subject}</td>
                      <td className="px-2 py-3"><StatusPill status={row.status} /></td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td className="px-2 py-4 text-muted" colSpan={4}>No sends found yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* ── Toast stack ──────────────────────────────────── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-5 py-4 shadow-lg text-sm font-medium max-w-sm fade-in ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}
          >
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button onClick={() => dismissToast(toast.id)} className="shrink-0 opacity-60 hover:opacity-100 transition leading-none text-lg mt-[-2px]" aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
