import Link from "next/link";
import { PLANS, OVERAGE_NOTE, SIGNUP_HREF, type Faq } from "@/lib/site";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="SwayamMail home">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="white" strokeWidth="1.2" />
          <path d="M1.5 4L6 7L10.5 4" stroke="white" strokeWidth="1.2" />
        </svg>
      </span>
      <span className="font-display text-lg font-medium tracking-tight">SwayamMail</span>
    </Link>
  );
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5" aria-label="Main">
        <Logo />
        <div className="hidden items-center gap-7 text-sm text-muted md:flex">
          <Link href="/email-otp-api" className="hover:text-foreground">Email OTP API</Link>
          <Link href="/#products" className="hover:text-foreground">Products</Link>
          <Link href="/#pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/docs" className="hover:text-foreground">Docs</Link>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/signin" className="hidden text-muted hover:text-foreground sm:inline">Sign in</Link>
          <Link
            href={SIGNUP_HREF}
            className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background transition-opacity hover:opacity-85"
          >
            Start free
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3">© 2026 Yugaas, Hyderabad, India.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/email-otp-api" className="hover:text-foreground">Email OTP API</Link>
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/docs" className="hover:text-foreground">Documentation</Link>
          <Link href="/signin" className="hover:text-foreground">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}

export function CodeCard({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2a2a22] bg-[#15150f] text-left card-shadow">
      <div className="flex items-center gap-2 border-b border-[#2a2a22] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a30]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a30]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a30]" />
        <span className="ml-2 font-mono text-xs text-[#9a9a8c]">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-[#e9e7dc]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function PricingGrid() {
  return (
    <div>
      <div className="grid gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`flex flex-col justify-between rounded-2xl border bg-surface p-6 ${
              plan.highlight ? "border-accent-dark card-shadow" : "border-border"
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{plan.name}</h3>
                {plan.highlight ? (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-dark">
                    Most popular
                  </span>
                ) : null}
              </div>
              <p className="my-2 text-3xl font-semibold">
                {plan.price}
                {plan.priceValue > 0 ? <span className="text-sm font-normal text-muted">/mo + GST</span> : null}
              </p>
              <p className="text-sm text-muted">{plan.emails}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span className="text-accent-dark" aria-hidden="true">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href={SIGNUP_HREF}
              className="mt-6 inline-block w-full rounded-lg bg-foreground px-4 py-2.5 text-center text-sm font-semibold text-background transition-opacity hover:opacity-85"
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center text-sm text-muted">{OVERAGE_NOTE}</p>
    </div>
  );
}

export function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-surface text-left">
      {faqs.map(({ q, a }) => (
        <details key={q} className="group px-6 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
            <h3 className="text-base">{q}</h3>
            <span className="text-muted transition-transform group-open:rotate-45" aria-hidden="true">+</span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
        </details>
      ))}
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function FinalCta({ title, body }: { title: string; body: string }) {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="rounded-3xl bg-foreground px-6 py-14 text-center text-background">
        <h2 className="font-display text-3xl sm:text-4xl">{title}</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-[#c9c7ba]">{body}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href={SIGNUP_HREF} className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-foreground">
            Create a free account
          </Link>
          <Link href="/docs" className="rounded-lg border border-[#4a4a40] px-5 py-3 text-sm font-semibold">
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}
