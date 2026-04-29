"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/sends", label: "Sends" },
  { href: "/contacts", label: "Contacts" },
  { href: "/lists", label: "Lists" },
  { href: "/domains", label: "Domains" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:gap-10 border-r border-border bg-surface/70 px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-2xl bg-foreground text-background grid place-items-center text-sm font-semibold">
          SM
        </div>
        <div>
          <p className="text-sm font-semibold tracking-[0.08em] text-muted uppercase">SwayamMail</p>
          <p className="font-display text-lg text-foreground">Dashboard</p>
        </div>
      </div>

      <nav className="flex flex-col gap-2">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm transition ${
                active
                  ? "bg-accent-soft text-accent-dark"
                  : "text-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <span className={active ? "font-semibold" : "font-medium"}>{item.label}</span>
              <span className="text-xs">→</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-border bg-surface-muted px-4 py-4 text-xs text-muted">
        <p className="font-semibold text-foreground">v0.1 beta</p>
        <p className="mt-1">Focused on reliable deliverability for Indian SaaS teams.</p>
      </div>
    </aside>
  );
}
