"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-gate";
import { Topbar } from "@/components/topbar";

type ListItem = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type ListsResponse = {
  lists: ListItem[];
};

export default function ListsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    apiFetch<ListsResponse>("/v1/lists", token)
      .then((response) => {
        setItems(response.lists);
        setError(null);
      })
      .catch((err) => setError(err?.message ?? "Failed to load lists"))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar title="Lists" subtitle="Segmented audiences and saved cohorts." />
      <main className="flex flex-col gap-8 px-6 py-8">
        <section className="rounded-3xl border border-border bg-surface px-6 py-6 card-shadow fade-in">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl">Audience lists</h3>
            <span className="text-xs text-muted">{items.length} lists</span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr className="border-b border-border">
                  <th className="px-2 py-3 text-left">List</th>
                  <th className="px-2 py-3 text-left">Description</th>
                  <th className="px-2 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={3}>
                      Loading lists...
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td className="px-2 py-4 text-red-600" colSpan={3}>
                      {error}
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="px-2 py-3 text-foreground">{row.name}</td>
                      <td className="px-2 py-3 text-muted">{row.description ?? "—"}</td>
                      <td className="px-2 py-3 text-muted">
                        {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-2 py-4 text-muted" colSpan={3}>
                      No lists found yet.
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
