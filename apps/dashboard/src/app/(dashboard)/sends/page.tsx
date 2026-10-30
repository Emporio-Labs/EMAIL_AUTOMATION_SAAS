"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { StatusPill } from "@/components/status-pill";
import { MERGE_TAG_HELP, TemplatePicker } from "@/components/template-picker";

// ── Types ──────────────────────────────────────────────────────────────────────

type SendItem = {
  job_id: string;
  from_email: string;
  to_email: string;
  subject: string;
  status: string;
  email_type: string;
  created_at: string;
  sent_at: string | null;
  failed_at: string | null;
};

type SendsResponse = { page: number; limit: number; total: number; items: SendItem[] };

type CampaignItem = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  contacts_count: number;
  created_at: string;
  updated_at: string;
};

type CampaignsResponse = { campaigns: CampaignItem[] };
type CreateCampaignResponse = { campaign: CampaignItem };

type ListItem = { id: string; name: string; description: string | null; type: string };
type Contact = { id: string; email: string; first_name: string | null; last_name: string | null };
type ListContact = { contact_id: string; contacts: Contact };
type CampaignContactInput = { email: string; source: "list" | "manual" };

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
type SendsView = "transactional" | "marketing";

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SendsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<SendItem[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [form, setForm] = useState({ subject: "", html: "" });
  const [emailType, setEmailType] = useState<"transactional" | "marketing">("transactional");
  const [sending, setSending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [emailTypeFilter, setEmailTypeFilter] = useState<"all" | "transactional" | "marketing">("all");
  const [activeView, setActiveView] = useState<SendsView>("transactional");
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    description: "",
    contacts: {} as Record<string, "list" | "manual">,
  });
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [showAddFromListModal, setShowAddFromListModal] = useState(false);
  const [campaignManualInput, setCampaignManualInput] = useState("");
  const [addingFromListId, setAddingFromListId] = useState<string | null>(null);

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

  // Marketing campaign state
  const [marketingCampaignId, setMarketingCampaignId] = useState("");
  const [loadingMarketingRecipients, setLoadingMarketingRecipients] = useState(false);
  const [marketingRecipientEmails, setMarketingRecipientEmails] = useState<Set<string>>(new Set());

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

  async function loadMarketingRecipients(campaignId: string) {
    if (!token || !campaignId) {
      setMarketingRecipientEmails(new Set());
      return;
    }

    setLoadingMarketingRecipients(true);
    try {
      const res = await apiFetch<{ contacts: Array<{ email: string; is_subscribed: boolean }> }>(`/v1/campaigns/${campaignId}/contacts`, token);
      const emails = res.contacts.filter((contact) => contact.is_subscribed).map((contact) => contact.email);
      setMarketingRecipientEmails(new Set(emails));
    } catch {
      setMarketingRecipientEmails(new Set());
      addToast("error", "Failed to load campaign contacts.");
    } finally {
      setLoadingMarketingRecipients(false);
    }
  }

  // Load sends list
  function loadSends() {
    if (!token) return;
    setLoading(true);
    apiFetch<SendsResponse>("/v1/sends", token)
      .then((res) => { setItems(res.items); setError(null); })
      .catch((err) => setError(err?.message ?? "Failed to load sends"))
      .finally(() => setLoading(false));
  }

  function loadCampaigns() {
    if (!token) return;
    setLoadingCampaigns(true);
    apiFetch<CampaignsResponse>("/v1/campaigns", token)
      .then((res) => { setCampaigns(res.campaigns); setCampaignError(null); })
      .catch((err) => {
        const message = err?.message ?? "Failed to load campaigns";
        if (typeof message === "string" && message.includes("[404]")) {
          // Backward-compatible fallback when campaigns API is not deployed yet.
          setCampaigns([]);
          setCampaignError(null);
          return;
        }

        setCampaignError(message);
      })
      .finally(() => setLoadingCampaigns(false));
  }

  function loadLists() {
    if (!token) return;
    setLoadingLists(true);
    apiFetch<{ lists: ListItem[] }>("/v1/lists", token)
      .then((res) => setLists(res.lists))
      .catch(() => {})
      .finally(() => setLoadingLists(false));
  }

  useEffect(() => { loadSends(); }, [token]);

  useEffect(() => {
    // Load campaigns when marketing view is active.
    if (activeView !== "marketing") return;
    loadCampaigns();
  }, [activeView, emailType, token]);

  // Keep emailType in sync with the active view: transactional view forces transactional.
  useEffect(() => {
    setEmailType(activeView === "marketing" ? "marketing" : "transactional");
  }, [activeView]);

  useEffect(() => {
    if (!token) return;
    setLoadingAddresses(true);
    apiFetch<SendingAddressesResponse>("/v1/sending-addresses", token)
      .then((res) => setSendingAddresses(res.addresses))
      .catch(() => {})
      .finally(() => setLoadingAddresses(false));
  }, [token]);

  // Load lists when the recipient tab or campaign modal needs them
  useEffect(() => {
    if (!token) return;
    if (recipientTab !== "lists" && !showCampaignModal && emailType !== "marketing") return;
    loadLists();
  }, [recipientTab, showCampaignModal, emailType, token]);

  useEffect(() => {
    if (emailType !== "marketing" || campaigns.length === 0) return;
    if (!marketingCampaignId || !campaigns.some((campaign) => campaign.id === marketingCampaignId)) {
      setMarketingCampaignId(campaigns[0].id);
    }
  }, [emailType, campaigns, marketingCampaignId]);

  useEffect(() => {
    if (emailType !== "marketing") return;
    void loadMarketingRecipients(marketingCampaignId);
  }, [emailType, marketingCampaignId, token]);

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

  async function handleDeleteCampaign(campaignId: string) {
    if (!token) return;

    const confirmed = window.confirm("Delete this campaign? This will remove its saved recipient snapshot.");
    if (!confirmed) return;

    try {
      await apiFetch<{ success: boolean }>(`/v1/campaigns/${campaignId}`, token, {
        method: "DELETE",
      });

      setCampaigns((prev) => prev.filter((campaign) => campaign.id !== campaignId));
      if (marketingCampaignId === campaignId) {
        setMarketingCampaignId("");
        setMarketingRecipientEmails(new Set());
      }
      addToast("success", "Campaign deleted.");
    } catch (err: any) {
      const message = err?.message ?? "Failed to delete campaign.";
      if (typeof message === "string" && message.includes("[404]")) {
        setCampaigns((prev) => prev.filter((campaign) => campaign.id !== campaignId));
        if (marketingCampaignId === campaignId) {
          setMarketingCampaignId("");
          setMarketingRecipientEmails(new Set());
        }
        return;
      }

      addToast("error", message);
    }
  }

  // Filter contacts by search
  const filteredContacts = useMemo(() =>
    contacts.filter((c) =>
      c.email.toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.first_name ?? "").toLowerCase().includes(contactSearch.toLowerCase()) ||
      (c.last_name ?? "").toLowerCase().includes(contactSearch.toLowerCase())
    ), [contacts, contactSearch]);

  // Calculate analytics by email type
  const analytics = useMemo(() => {
    const transactionalItems = items.filter((item) => item.email_type === "transactional");
    const marketingItems = items.filter((item) => item.email_type === "marketing");

    const calculateStats = (itemsGroup: SendItem[]) => {
      const total = itemsGroup.length;
      const sent = itemsGroup.filter((item) => item.status === "sent").length;
      const failed = itemsGroup.filter((item) => item.status === "failed").length;
      const successRate = total > 0 ? ((sent / total) * 100).toFixed(1) : "0.0";
      return { total, sent, failed, successRate };
    };

    return {
      transactional: calculateStats(transactionalItems),
      marketing: calculateStats(marketingItems),
    };
  }, [items]);

  // Filter sends by email type
  const filteredSends = useMemo(() =>
    emailTypeFilter === "all"
      ? items
      : items.filter((item) => item.email_type === emailTypeFilter),
    [items, emailTypeFilter]);

  const campaignContacts = useMemo(
    () => Object.entries(campaignForm.contacts).map(([email, source]) => ({ email, source })),
    [campaignForm.contacts],
  );

  const isMarketing = activeView === "marketing";

  async function handleCreateCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;

    if (campaignContacts.length === 0) {
      setCampaignFormError("Add at least one campaign contact.");
      return;
    }

    setCreatingCampaign(true);
    setCampaignFormError(null);

    try {
      const response = await apiFetch<CreateCampaignResponse>("/v1/campaigns", token, {
        method: "POST",
        body: JSON.stringify({
          name: campaignForm.name,
          description: campaignForm.description || undefined,
          contacts: campaignContacts,
        }),
      });

      setCampaigns((prev) => [response.campaign, ...prev]);
      setShowCampaignModal(false);
      setCampaignForm({ name: "", description: "", contacts: {} });
      setCampaignManualInput("");
      router.push(`/sends/campaigns/${response.campaign.id}`);
    } catch (err: any) {
      setCampaignFormError(err?.message ?? "Failed to create campaign");
    } finally {
      setCreatingCampaign(false);
    }
  }

  function addCampaignContacts(nextContacts: CampaignContactInput[]) {
    setCampaignForm((prev) => {
      const merged = { ...prev.contacts };
      for (const contact of nextContacts) {
        const email = contact.email.trim().toLowerCase();
        if (!email) continue;
        if (!merged[email]) {
          merged[email] = contact.source;
        }
      }

      return { ...prev, contacts: merged };
    });
  }

  async function handleAddCampaignContactsFromList(listId: string) {
    if (!token || !listId) return;
    setAddingFromListId(listId);
    try {
      const res = await apiFetch<{ contacts: ListContact[] }>(`/v1/lists/${listId}/contacts`, token);
      const listEmails = res.contacts.map((row) => ({ email: row.contacts.email, source: "list" as const }));

      if (listEmails.length === 0) {
        addToast("error", "This list has no contacts yet.");
        return;
      }

      addCampaignContacts(listEmails);
      addToast("success", `Added ${listEmails.length} contact${listEmails.length === 1 ? "" : "s"} from list.`);
    } catch {
      addToast("error", "Failed to load list contacts.");
    } finally {
      setAddingFromListId(null);
    }
  }

  function handleAddCampaignManualContacts() {
    const manualContacts = campaignManualInput
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email, source: "manual" as const }));

    if (manualContacts.length === 0) return;

    addCampaignContacts(manualContacts);
    setCampaignManualInput("");
  }

  function removeCampaignContact(email: string) {
    setCampaignForm((prev) => {
      const next = { ...prev.contacts };
      delete next[email];
      return { ...prev, contacts: next };
    });
  }

  // Send emails
  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const toEmails = Array.from(recipientEmails);

    if (emailType === "marketing" && !marketingCampaignId) {
      addToast("error", "Select a campaign before sending marketing emails.");
      return;
    }

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
        body: JSON.stringify({
          subject: form.subject,
          html: form.html,
          from: fromAddress,
          toEmails,
          campaignId: emailType === "marketing" ? marketingCampaignId : undefined,
          emailType,
        }),
      });
      addToast("success", `✅ ${result.accepted} email${result.accepted !== 1 ? "s" : ""} queued successfully!`);
      setForm({ subject: "", html: "" });
      setEmailType("marketing");
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
        <div className="flex gap-2 rounded-full border border-border bg-surface-muted p-1 w-fit fade-in">
          <button
            type="button"
            onClick={() => setActiveView("transactional")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${activeView === "transactional" ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
          >
            Transactional
          </button>
          <button
            type="button"
            onClick={() => setActiveView("marketing")}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${activeView === "marketing" ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
          >
            Marketing
          </button>
        </div>

        {activeView === "transactional" ? (
          <>
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

              <TemplatePicker token={token} onPick={(t) => setForm((prev) => ({ ...prev, subject: t.subject, html: t.html }))} />

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

              {/* ── Email Type (only editable in Marketing view) ─────────────────────────────── */}
              {isMarketing && (
                <label className="flex flex-col gap-2 text-sm text-muted">
                  Email type *
                  <select
                    id="send-email-type-select"
                    className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                    value={emailType}
                    onChange={(e) => setEmailType(e.target.value as "transactional" | "marketing")}
                    required
                  >
                    <option value="marketing">Marketing</option>
                    <option value="transactional">Transactional</option>
                  </select>
                  <span className="text-xs text-muted">
                    {emailType === "transactional" ? "Transactional: OTPs, order updates, etc." : "Marketing: Promotions, newsletters, campaigns"}
                  </span>
                </label>
              )}

              {/* ── Recipients picker ───────────────────────── */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{emailType === "marketing" ? "Campaign recipients *" : "Recipients *"}</span>
                  {emailType === "transactional" && recipientEmails.size > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-muted hover:text-red-500 transition">
                      Clear all ({recipientEmails.size})
                    </button>
                  )}
                </div>

                {emailType === "marketing" ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3">
                      {loadingCampaigns ? (
                      <p className="text-xs text-muted">Loading campaigns...</p>
                      ) : campaigns.length === 0 ? (
                        <p className="text-xs text-muted">No campaigns found. Create a campaign first.</p>
                    ) : (
                      <>
                          <select
                            id="marketing-campaign-select"
                            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
                            value={marketingCampaignId}
                            onChange={(e) => setMarketingCampaignId(e.target.value)}
                          >
                            {campaigns.map((campaign) => (
                              <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.contacts_count} contacts)</option>
                            ))}
                          </select>
                        <p className="text-xs text-muted">
                          {loadingMarketingRecipients
                            ? "Loading campaign contacts..."
                            : `${marketingRecipientEmails.size} recipient${marketingRecipientEmails.size === 1 ? "" : "s"} ready to send.`}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <>
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
                              {lists.filter((l) => l.type !== 'marketing').map((l) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              id="add-from-list-btn"
                              onClick={handleAddFromList}
                              disabled={!selectedListId || loadingListContacts}
                              className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:opacity-80 disabled:opacity-50"
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
                              className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:opacity-80 disabled:opacity-50"
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
                          className="h-9 rounded-full bg-foreground text-xs font-semibold text-background transition hover:opacity-80 disabled:opacity-50"
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
                  </>
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
                <span className="text-xs">{MERGE_TAG_HELP}</span>
              </label>

              <button
                id="send-emails-btn"
                type="submit"
                disabled={sending || (emailType === "marketing" ? marketingRecipientEmails.size === 0 : recipientEmails.size === 0)}
                className="h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 active:scale-[0.98] disabled:opacity-60"
              >
                {sending
                  ? "Sending..."
                  : (emailType === "marketing" ? marketingRecipientEmails.size > 0 : recipientEmails.size > 0)
                  ? `Send to ${emailType === "marketing" ? marketingRecipientEmails.size : recipientEmails.size} recipient${(emailType === "marketing" ? marketingRecipientEmails.size : recipientEmails.size) !== 1 ? "s" : ""}`
                  : "Send emails"}
              </button>
            </form>
          </div>

          {/* ── Delivery snapshot ─────────────────────────── */}
          <div className="rounded-3xl border border-border bg-surface-muted px-6 py-6">
            <h3 className="font-display text-xl">Email analytics</h3>
            <p className="mt-2 text-sm text-muted">
              Track delivery performance by email type.
            </p>
            
            <div className="mt-6 grid gap-4">
              {/* Transactional Card */}
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-blue-700">Transactional</p>
                    <p className="mt-2 text-lg font-bold text-blue-900">{analytics.transactional.total}</p>
                    <p className="text-xs text-blue-600 mt-1">Success rate: <span className="font-semibold">{analytics.transactional.successRate}%</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-blue-600">Sent: {analytics.transactional.sent}</p>
                    <p className="text-xs text-blue-600">Failed: {analytics.transactional.failed}</p>
                  </div>
                </div>
              </div>

              {/* Marketing Card */}
              <div className="rounded-xl bg-purple-50 border border-purple-200 px-4 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-purple-700">Marketing</p>
                    <p className="mt-2 text-lg font-bold text-purple-900">{analytics.marketing.total}</p>
                    <p className="text-xs text-purple-600 mt-1">Success rate: <span className="font-semibold">{analytics.marketing.successRate}%</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-purple-600">Sent: {analytics.marketing.sent}</p>
                    <p className="text-xs text-purple-600">Failed: {analytics.marketing.failed}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick snapshot */}
            <div className="mt-6 flex flex-col gap-3 text-sm text-muted">
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                <span>Queue priority</span>
                <strong className="text-foreground">Standard</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
                <span>Total sends</span>
                <strong className="text-foreground">{items.length}</strong>
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
          
          {/* ── Email Type Filter ─────────────────────────── */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-muted">Filter by type:</span>
            <div className="flex gap-2">
              {(["all", "transactional", "marketing"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setEmailTypeFilter(type)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    emailTypeFilter === type
                      ? "bg-foreground text-background"
                      : "bg-surface-muted text-muted hover:text-foreground border border-border"
                  }`}
                >
                  {type === "all" ? "All" : type === "transactional" ? "Transactional" : "Marketing"}
                </button>
              ))}
            </div>
          </div>
          
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Recipient</th>
                  <th className="px-2 py-3 text-left">Subject</th>
                  <th className="px-2 py-3 text-left">Type</th>
                  <th className="px-2 py-3 text-left">Status</th>
                  <th className="px-2 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-2 py-4 text-muted" colSpan={5}>Loading sends...</td></tr>
                ) : error ? (
                  <tr><td className="px-2 py-4 text-red-600" colSpan={5}>{error}</td></tr>
                ) : filteredSends.length ? (
                  filteredSends.map((row) => (
                    <tr key={row.job_id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{row.to_email}</td>
                      <td className="px-2 py-3 text-muted">{row.subject}</td>
                      <td className="px-2 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          row.email_type === "transactional"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-purple-100 text-purple-700"
                        }`}>
                          {row.email_type === "transactional" ? "Transactional" : "Marketing"}
                        </span>
                      </td>
                      <td className="px-2 py-3"><StatusPill status={row.status} /></td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td className="px-2 py-4 text-muted" colSpan={5}>No sends found yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
          </>
        ) : (
          <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl text-foreground">Campaigns</h2>
                <p className="mt-1 text-sm text-muted">Manage recurring marketing campaigns and inspect performance.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCampaignModal(true)}
                className="h-10 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 active:scale-95"
              >
                Add a campaign
              </button>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-muted">
                  <tr className="border-b border-border">
                    <th className="px-2 py-3 text-left">Campaign name</th>
                    <th className="px-2 py-3 text-left">Description</th>
                    <th className="px-2 py-3 text-left">Contacts</th>
                    <th className="px-2 py-3 text-left">Mail history</th>
                    <th className="px-2 py-3 text-left">Analytics</th>
                    <th className="px-2 py-3 text-left">Send</th>
                    <th className="px-2 py-3 text-left">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCampaigns ? (
                    <tr><td className="px-2 py-4 text-muted" colSpan={7}>Loading campaigns...</td></tr>
                  ) : campaignError ? (
                    <tr><td className="px-2 py-4 text-red-600" colSpan={7}>{campaignError}</td></tr>
                  ) : campaigns.length ? (
                    campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-border/60">
                        <td className="px-2 py-3 text-foreground font-medium">{campaign.name}</td>
                        <td className="px-2 py-3 text-muted">{campaign.description ?? "—"}</td>
                        <td className="px-2 py-3 text-muted">
                          {campaign.contacts_count} contact{campaign.contacts_count === 1 ? "" : "s"}
                        </td>
                        <td className="px-2 py-3 text-muted">
                          <Link href={`/sends/campaigns/${campaign.id}/mail-history`} className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark inline-flex items-center">
                            View
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-muted">
                          <Link href={`/sends/campaigns/${campaign.id}/analytics`} className="h-7 rounded-full border border-border px-3 text-xs font-semibold text-muted transition hover:border-accent hover:text-accent-dark inline-flex items-center">
                            View
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-muted">
                          {campaign.contacts_count > 0 ? (
                            <Link href={`/sends/campaigns/${campaign.id}`} className="h-7 rounded-full border border-foreground px-3 text-xs font-semibold text-foreground bg-foreground/10 transition hover:bg-foreground hover:text-background inline-flex items-center">
                              Send
                            </Link>
                          ) : (
                            <span className="text-xs text-muted">No contacts</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-muted">
                          <button
                            type="button"
                            onClick={() => void handleDeleteCampaign(campaign.id)}
                            className="h-7 rounded-full border border-red-200 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 inline-flex items-center"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-2 py-8 text-center text-muted" colSpan={7}>
                        No campaigns yet. Create one to start tracking marketing activity.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {showCampaignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCampaignModal(false); }}
        >
          <div className="w-full max-w-lg rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl">Add a campaign</h2>
              <button onClick={() => setShowCampaignModal(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition" aria-label="Close">×</button>
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleCreateCampaign}>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Campaign name *
                <input
                  className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  required
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-muted">
                Description
                <textarea
                  className="min-h-[96px] rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground outline-none focus:border-accent resize-none"
                  value={campaignForm.description}
                  onChange={(e) => setCampaignForm({ ...campaignForm, description: e.target.value })}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-muted">
                Campaign Contacts
                <div className="rounded-xl border border-border bg-surface-muted px-4 py-3 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-full border border-border px-4 text-xs font-semibold text-foreground transition hover:bg-surface"
                      onClick={() => setShowAddFromListModal(true)}
                    >
                      + Add from list
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-full border border-border px-4 text-xs font-semibold text-foreground transition hover:bg-surface"
                      onClick={handleAddCampaignManualContacts}
                      disabled={!campaignManualInput.trim()}
                    >
                      + Add manually
                    </button>
                  </div>

                  <textarea
                    className="min-h-[72px] rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-accent resize-none"
                    placeholder="john@example.com, jane@example.com"
                    value={campaignManualInput}
                    onChange={(event) => setCampaignManualInput(event.target.value)}
                  />

                  <p className="text-xs text-muted">{campaignContacts.length} contacts added</p>

                  {campaignContacts.length > 0 && (
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border bg-surface px-3 py-2">
                      {campaignContacts.map((contact) => (
                        <span
                          key={contact.email}
                          className="inline-flex items-center gap-1 rounded-full bg-surface-muted border border-border px-2.5 py-0.5 text-xs text-foreground"
                        >
                          {contact.email}
                          <button
                            type="button"
                            onClick={() => removeCampaignContact(contact.email)}
                            className="text-muted hover:text-red-500 transition leading-none text-sm"
                            aria-label={`Remove ${contact.email}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </label>

              {campaignFormError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{campaignFormError}</p>}

              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setShowCampaignModal(false)} className="flex-1 h-11 rounded-full border border-border text-sm font-semibold text-muted transition hover:bg-surface-muted">
                  Cancel
                </button>
                <button type="submit" disabled={creatingCampaign} className="flex-1 h-11 rounded-full bg-foreground text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60">
                  {creatingCampaign ? "Creating..." : "Create campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddFromListModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
          onClick={(event) => { if (event.target === event.currentTarget) setShowAddFromListModal(false); }}
        >
          <div className="w-full max-w-2xl rounded-3xl border border-border bg-surface px-8 py-8 card-shadow fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-2xl">Add contacts from list</h3>
              <button
                type="button"
                onClick={() => setShowAddFromListModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border bg-surface-muted">
              {loadingLists ? (
                <p className="p-4 text-sm text-muted">Loading lists...</p>
              ) : lists.length === 0 ? (
                <p className="p-4 text-sm text-muted">No lists found.</p>
              ) : (
                <div className="divide-y divide-border">
                  {lists.map((list) => (
                    <div key={list.id} className="flex items-center justify-between gap-3 p-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{list.name}</p>
                        <p className="text-xs text-muted">{list.type} list</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddCampaignContactsFromList(list.id)}
                        disabled={addingFromListId === list.id}
                        className="h-9 rounded-full bg-foreground px-4 text-xs font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                      >
                        {addingFromListId === list.id ? "Adding..." : "Add contacts"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
