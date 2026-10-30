"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

type TemplateSummary = { id: string; name: string };
type TemplateDetail = { id: string; name: string; subject: string; html: string };

// Fills a subject and HTML body from a saved template. The merge tags stay in
// the copied content and are filled per recipient when the email is sent.
export function TemplatePicker({
  token,
  onPick,
}: {
  token: string | null;
  onPick: (template: { subject: string; html: string }) => void;
}) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch<{ templates: TemplateSummary[] }>("/v1/templates", token)
      .then((response) => setTemplates(response.templates))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [token]);

  async function choose(id: string) {
    setSelected(id);
    if (!id || !token) return;
    const { template } = await apiFetch<{ template: TemplateDetail }>(`/v1/templates/${id}`, token);
    onPick({ subject: template.subject, html: template.html });
  }

  if (!loading && templates.length === 0) {
    return (
      <p className="text-xs text-muted">
        Save reusable emails under{" "}
        <Link href="/templates" className="font-semibold text-accent-dark hover:underline underline-offset-2">
          Templates
        </Link>{" "}
        to start from one here.
      </p>
    );
  }

  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      Start from a template
      <select
        className="h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm text-foreground outline-none focus:border-accent"
        value={selected}
        onChange={(e) => void choose(e.target.value)}
        disabled={loading}
      >
        <option value="">{loading ? "Loading templates..." : "Choose a template (replaces subject and body)"}</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export const MERGE_TAG_HELP =
  "Personalise with {{first_name}}, {{last_name}}, {{full_name}}, {{email}} or any custom contact field like {{company}}. Add a fallback with {{ first_name | there }}.";
