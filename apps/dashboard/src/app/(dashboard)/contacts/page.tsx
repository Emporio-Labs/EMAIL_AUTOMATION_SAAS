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
  created_at: string;
};

type ContactsResponse = {
  contacts: Contact[];
};

export default function ContactsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    apiFetch<ContactsResponse>("/v1/contacts", token)
      .then((response) => {
        setItems(response.contacts);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Contacts" subtitle="All recipients across your lists." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">All contacts</h3>
            <span className="text-xs text-muted">{items.length} contacts</span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">Email</th>
                  <th className="px-2 py-3 text-left">First name</th>
                  <th className="px-2 py-3 text-left">Last name</th>
                  <th className="px-2 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={4}>
                      Loading contacts...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="px-2 py-4 text-red-600" colSpan={4}>
                      {error}
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{row.email}</td>
                      <td className="px-2 py-3 text-muted">{row.first_name ?? "—"}</td>
                      <td className="px-2 py-3 text-muted">{row.last_name ?? "—"}</td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={4}>
                      No contacts found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
