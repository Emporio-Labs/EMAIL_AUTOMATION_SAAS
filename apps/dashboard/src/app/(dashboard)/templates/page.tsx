"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";
import { MERGE_TAG_HELP } from "@/components/template-picker";

type TemplateSummary = { id: string; name: string; subject: string; updated_at: string };
type Template = TemplateSummary & { html: string; text: string | null; mergeTags: string[] };
type Preview = { subject: string; html: string; text: string };

const EMPTY = { name: "", subject: "", html: "", text: "" };

const STARTER_HTML = `<html>
  <body style="font-family: Arial, sans-serif; color: #202124;">
    <p>Hi {{ first_name | there }},</p>
    <p>Your report for {{ month }} is ready.</p>
    <p><a href="{{ report_url }}">View your report</a></p>
    <p>Thanks,<br />{{ sender_name | The team }}</p>
  </body>
</html>`;

function errorMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

export default function TemplatesPage() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // null: nothing open; "new": unsaved template; otherwise the template id.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [mergeTags, setMergeTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [previewEmail, setPreviewEmail] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  function load() {
    if (!token) return;
    apiFetch<{ templates: TemplateSummary[] }>("/v1/templates", token)
      .then((response) => {
        setTemplates(response.templates);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err) ?? "Failed to load templates"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  function startNew() {
    setEditing("new");
    setForm({ ...EMPTY, subject: "Your {{ month }} report, {{ first_name | there }}", html: STARTER_HTML });
    setMergeTags([]);
    setPreview(null);
    setNotice(null);
    setFormError(null);
  }

  async function open(id: string) {
    if (!token) return;
    setNotice(null);
    setFormError(null);
    setPreview(null);
    try {
      const { template } = await apiFetch<{ template: Template }>(`/v1/templates/${id}`, token);
      setEditing(id);
      setForm({ name: template.name, subject: template.subject, html: template.html, text: template.text ?? "" });
      setMergeTags(template.mergeTags);
    } catch (err) {
      setError(errorMessage(err) ?? "Failed to open template");
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !editing) return;
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const body = JSON.stringify({ name: form.name, subject: form.subject, html: form.html, text: form.text || null });
      const { template } = editing === "new"
        ? await apiFetch<{ template: Template }>("/v1/templates", token, { method: "POST", body })
        : await apiFetch<{ template: Template }>(`/v1/templates/${editing}`, token, { method: "PATCH", body });
      setEditing(template.id);
      setMergeTags(template.mergeTags);
      setNotice("Template saved.");
      load();
    } catch (err) {
      setFormError(errorMessage(err) ?? "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!token || !editing || editing === "new") return;
    if (!window.confirm(`Delete "${form.name}"? Emails already sent are not affected.`)) return;
    try {
      await apiFetch(`/v1/templates/${editing}`, token, { method: "DELETE" });
      setEditing(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err) ?? "Failed to delete template");
    }
  }

  async function runPreview() {
    if (!token || !editing || editing === "new") return;
    setPreviewError(null);
    try {
      const result = await apiFetch<Preview>(`/v1/templates/${editing}/preview`, token, {
        method: "POST",
        body: JSON.stringify(previewEmail ? { contactEmail: previewEmail } : {}),
      });
      setPreview(result);
    } catch (err) {
      setPreviewError(errorMessage(err) ?? "Preview failed");
    }
  }

  const inputClass = "h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent";

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Templates" subtitle="Reusable emails with merge tags, for campaigns and the API." />
      <main className="flex flex-col gap-8 px-6 py-8 lg:flex-row lg:items-start">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in lg:w-80 lg:shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">Saved</h3>
            <button
              onClick={startNew}
              className="h-9 rounded-full bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-80 active:scale-95"
            >
              + New
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-1">
            {loading ? (
              <p className="text-sm text-muted">Loading templates...</p>
            ) : error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted">No templates yet. Create one for bills, reports or newsletters.</p>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void open(t.id)}
                  className={`rounded-xl px-3 py-2 text-left transition hover:bg-surface-muted ${editing === t.id ? "bg-surface-muted" : ""}`}
                >
                  <div className="text-sm font-semibold text-foreground">{t.name}</div>
                  <div className="truncate text-xs text-muted">{t.subject}</div>
                </button>
              ))
            )}
          </div>
        </section>

        {editing ? (
          <section className="flex-1 rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
            <form className="flex flex-col gap-4" onSubmit={save}>
              <h3 className="font-display text-2xl">{editing === "new" ? "New template" : form.name}</h3>
              <p className="text-xs text-muted">{MERGE_TAG_HELP}</p>

              <label className="flex flex-col gap-2 text-sm text-muted">
                Name *
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Monthly bill" required />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                Subject *
                <input className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                HTML body *
                <textarea
                  className="min-h-[240px] rounded-xl border border-border bg-surface-muted px-4 py-3 font-mono text-sm text-foreground outline-none focus:border-accent"
                  value={form.html}
                  onChange={(e) => setForm({ ...form, html: e.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-muted">
                <div className="flex items-baseline justify-between">
                  <span>Plain-text version</span>
                  <span className="text-xs">Optional. Made from the HTML when empty.</span>
                </div>
                <textarea
                  className="min-h-[100px] rounded-xl border border-border bg-surface-muted px-4 py-3 font-mono text-sm text-foreground outline-none focus:border-accent"
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                />
              </label>

              {mergeTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  Merge tags used:
                  {mergeTags.map((tag) => (
                    <span key={tag} className="rounded-full bg-accent-soft px-3 py-1 font-mono text-accent-dark">{`{{${tag}}}`}</span>
                  ))}
                </div>
              )}

              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{formError}</p>}
              {notice && <p className="text-sm text-accent-dark bg-accent-soft rounded-xl px-4 py-2">{notice}</p>}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="h-11 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition hover:opacity-80 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save template"}
                </button>
                {editing !== "new" && (
                  <button type="button" onClick={() => void remove()} className="h-11 rounded-full border border-border px-5 text-sm font-semibold text-red-600 transition hover:bg-red-50">
                    Delete
                  </button>
                )}
              </div>
            </form>

            {editing !== "new" && (
              <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6">
                <h4 className="font-display text-xl">Preview</h4>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-1 flex-col gap-2 text-sm text-muted">
                    As this contact (optional)
                    <input className={inputClass} type="email" placeholder="client@company.com" value={previewEmail} onChange={(e) => setPreviewEmail(e.target.value)} />
                  </label>
                  <button type="button" onClick={() => void runPreview()} className="h-11 rounded-full border border-border px-5 text-sm font-semibold text-foreground transition hover:bg-surface-muted">
                    Preview saved version
                  </button>
                </div>
                {previewError && <p className="text-sm text-red-600">{previewError}</p>}
                {preview && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm">
                      <span className="text-muted">Subject: </span>
                      <span className="font-semibold text-foreground">{preview.subject}</span>
                    </p>
                    <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[420px] w-full rounded-xl border border-border bg-white" />
                    <details className="text-sm text-muted">
                      <summary className="cursor-pointer">Plain-text version</summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-muted p-4 font-mono text-xs text-foreground">{preview.text}</pre>
                    </details>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="flex-1 rounded-3xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted">
            Pick a template to edit, or create a new one.
          </section>
        )}
      </main>
    </div>
  );
}
