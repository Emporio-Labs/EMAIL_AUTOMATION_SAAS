import type { Metadata } from "next";
import Link from "next/link";
import { LandingRedirect } from "@/components/landing-redirect";
import {
  CodeCard,
  FaqList,
  FinalCta,
  JsonLd,
  MarketingFooter,
  MarketingNav,
  PricingGrid,
} from "@/components/marketing/site-chrome";
import { PLANS, SIGNUP_HREF, SITE_NAME, SITE_URL, faqJsonLd, type Faq } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const otpSample = `# 1. Send a code
curl https://api.swayammail.yugaas.in/v1/otp/send \\
  -H "x-api-key: sk_prod_..." \\
  -H "content-type: application/json" \\
  -d '{ "email": "user@example.com" }'

# 2. Check what the user typed
curl https://api.swayammail.yugaas.in/v1/otp/verify \\
  -H "x-api-key: sk_prod_..." \\
  -H "content-type: application/json" \\
  -d '{ "email": "user@example.com", "code": "482913" }'

{ "valid": true }`;

const products = [
  {
    tag: "Email OTP",
    title: "Login and signup codes in two API calls",
    body: "We generate the code, email it on a fast lane that never waits behind campaigns, and verify it for you. Nothing to store, nothing to build.",
    points: ["Codes expire in 10 minutes and work once", "Rate limits and CAPTCHA built in", "Sandbox keys return the code for testing"],
    href: "/email-otp-api",
    link: "See the Email OTP API",
  },
  {
    tag: "Transactional API",
    title: "Receipts, alerts and invoices from your app",
    body: "One POST sends an email. Batch up to 100 at a time, attach files by link, and follow every message from sent to delivered.",
    points: ["Idempotency keys so retries never double-send", "Signed webhooks for delivery and bounce events", "Bounced addresses are suppressed automatically"],
    href: "/docs",
    link: "Read the API docs",
  },
  {
    tag: "Campaigns",
    title: "Newsletters and offers to your own lists",
    body: "Keep contacts in lists, send HTML or plain text campaigns from the dashboard, and see who opened and clicked.",
    points: ["Unsubscribe links handled for you", "Open and click tracking", "Per-campaign delivery history"],
    href: SIGNUP_HREF,
    link: "Try it free",
  },
];

const reasons = [
  {
    title: "One product, not three",
    body: "Most providers make you buy a transactional service, a marketing tool and an OTP vendor separately. Here they share one account, one domain setup and one bill.",
  },
  {
    title: "Flat monthly plans in rupees",
    body: "No credits that expire and no dollar invoices. Pick a plan, know your cost for the month, and pay in INR plus GST.",
  },
  {
    title: "We set up your domain with you",
    body: "SPF, DKIM and DMARC are where most small businesses get stuck. Tell us your domain and we will walk you through every DNS record until it shows verified.",
  },
  {
    title: "Sent from Mumbai",
    body: "Mail goes out through Amazon SES in the Mumbai region, from your own verified domain, so your sender reputation stays yours.",
  },
];

const steps = [
  {
    title: "Verify your domain",
    body: "Add your domain and we give you the DNS records. We check them automatically and tell you when you are ready to send.",
  },
  {
    title: "Create an API key",
    body: "Start with a sandbox key that sends nothing, then switch to a production key when your flow works.",
  },
  {
    title: "Send",
    body: "Call the OTP or send API from your app, or compose a campaign in the dashboard.",
  },
];

const audiences = [
  { title: "Apps and SaaS products", body: "Passwordless login, signup verification, receipts and alerts." },
  { title: "Gyms and studios", body: "Membership renewals, class reminders and monthly offers." },
  { title: "Clinics", body: "Appointment confirmations, reports ready alerts and follow-ups." },
  { title: "Agencies", body: "Run campaigns for several clients, each on their own domain." },
];

const faqs: Faq[] = [
  {
    q: "What is SwayamMail?",
    a: "SwayamMail is an email sending service for Indian businesses and developers. One account gives you an email OTP API, a transactional email API and marketing campaigns, all sent from your own verified domain.",
  },
  {
    q: "Can I send OTP codes by email with SwayamMail?",
    a: "Yes. Call /v1/otp/send with the user's email address and we generate and deliver a one-time code. Call /v1/otp/verify with the code the user typed and we tell you whether it is valid. You do not have to generate, store or expire codes yourself.",
  },
  {
    q: "Can I send both transactional and marketing email?",
    a: "Yes. The send API is for transactional mail such as receipts and alerts, and the dashboard lets you send campaigns to your contact lists with unsubscribe handling and open and click tracking. Marketing campaigns are available on paid plans.",
  },
  {
    q: "How much does it cost?",
    a: "There is a free plan with 1,000 emails a month. Paid plans are ₹499 for 25,000 emails, ₹1,499 for 100,000 and ₹5,999 for 500,000 per month, plus 18% GST. Extra emails cost ₹15 per 1,000.",
  },
  {
    q: "Do I need my own domain?",
    a: "Yes. You send from a domain you own, verified with DKIM, so the reputation you build belongs to you. We help you add the DNS records.",
  },
  {
    q: "Can I test without sending real email?",
    a: "Yes. Sandbox API keys accept the same requests as production keys but send nothing. For OTP, the sandbox response includes the code so you can test your whole flow.",
  },
];

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Email OTP API, transactional email API and marketing campaigns for Indian businesses, on flat monthly plans priced in rupees.",
  offers: PLANS.map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    price: plan.priceValue,
    priceCurrency: "INR",
    description: plan.emails,
  })),
  publisher: { "@type": "Organization", name: "Yugaas", url: "https://www.yugaas.in" },
};

export default function LandingPage() {
  return (
    <>
      <LandingRedirect />
      <JsonLd data={softwareJsonLd} />
      <JsonLd data={faqJsonLd(faqs)} />
      <MarketingNav />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="fade-in">
            <p className="mb-5 inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-accent-dark">
              Email infrastructure for Indian businesses
            </p>
            <h1 className="font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Email OTP, transactional and marketing email from one API.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Send login codes, receipts and campaigns from your own domain. Flat monthly plans in rupees, starting
              free, with a team that sets up your DNS with you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={SIGNUP_HREF}
                className="rounded-lg bg-foreground px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-85"
              >
                Start free: 1,000 emails a month
              </Link>
              <Link
                href="/email-otp-api"
                className="rounded-lg border border-border bg-surface px-5 py-3 text-sm font-semibold hover:border-foreground"
              >
                See the Email OTP API
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted">No card needed. Sandbox keys send nothing until you are ready.</p>
          </div>
          <div className="fade-in-delay-1 min-w-0">
            <CodeCard title="Email OTP in two calls" code={otpSample} />
          </div>
        </section>

        <section id="products" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
          <h2 className="font-display text-3xl sm:text-4xl">Three kinds of email, one account.</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Verify your domain once and use it for everything your business sends.
          </p>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {products.map((product) => (
              <article key={product.tag} className="flex flex-col rounded-2xl border border-border bg-surface p-6">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-dark">{product.tag}</p>
                <h3 className="mt-3 text-xl font-semibold leading-snug">{product.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{product.body}</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {product.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="text-accent-dark" aria-hidden="true">✓</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <Link href={product.href} className="mt-6 text-sm font-semibold text-accent-dark hover:underline">
                  {product.link} →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-surface-muted">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-3xl sm:text-4xl">Why teams pick SwayamMail.</h2>
            <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {reasons.map((reason) => (
                <div key={reason.title} className="border-l-2 border-accent pl-5">
                  <h3 className="text-lg font-semibold">{reason.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{reason.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl sm:text-4xl">Live in an afternoon.</h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border bg-surface p-6">
                <span className="font-mono text-sm text-accent-dark">0{index + 1}</span>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <h2 className="font-display text-3xl sm:text-4xl">Built for businesses like yours.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {audiences.map((audience) => (
              <div key={audience.title} className="rounded-2xl bg-accent-soft p-5">
                <h3 className="font-semibold">{audience.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{audience.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 text-center">
          <h2 className="font-display text-3xl sm:text-4xl">Simple monthly pricing in rupees.</h2>
          <p className="mx-auto mb-10 mt-3 max-w-xl text-muted">
            No credits to top up and nothing that expires. Start free and move up when you need more.
          </p>
          <PricingGrid />
        </section>

        <section className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="mb-8 text-center font-display text-3xl sm:text-4xl">Questions, answered.</h2>
          <FaqList faqs={faqs} />
        </section>

        <FinalCta
          title="Send your first email today."
          body="Create a free account, verify your domain and send 1,000 emails a month at no cost."
        />
      </main>

      <MarketingFooter />
    </>
  );
}
