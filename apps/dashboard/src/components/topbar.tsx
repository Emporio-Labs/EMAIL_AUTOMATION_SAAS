"use client";

import { useAuth } from "@/components/auth-gate";

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user, signOut } = useAuth();

  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface/70 px-6 py-5 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Dashboard</p>
        <h1 className="font-display text-3xl text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="rounded-full border border-border bg-surface-muted px-4 py-2 text-xs text-muted">
          {user?.email ?? ""}
        </div>
        <button
          className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-muted"
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
