import type { Metadata } from "next";
import Link from "next/link";
import {
  CodeCard,
  FaqList,
  FinalCta,
  JsonLd,
  MarketingFooter,
  MarketingNav,
} from "@/components/marketing/site-chrome";
import { SIGNUP_HREF, SITE_URL, faqJsonLd, type Faq } from "@/lib/site";

const title = "Email OTP API: send and verify OTP codes by email";
const description =
  "Send one-time passwords by email with two API calls. SwayamMail generates, delivers and verifies the code for you, with rate limits, CAPTCHA and expiry built in. Free for 1,000 emails a month.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/email-otp-api" },
  openGraph: { title, description, url: "/email-otp-api", type: "article" },
};

const sendSample = `curl https://api.swayammail.yugaas.in/v1/otp/send \\
  -H "x-api-key: sk_prod_..." \\
  -H "content-type: application/json" \\
  -d '{
    "email": "user@example.com",
    "ip": "203.0.113.7",
    "purpose": "login"
  }'

202 {
  "id": "8c1e...",
  "email": "user@example.com",
  "expires_at": "2026-10-30T10:10:00Z"
}`;

const verifySample = `curl https://api.swayammail.yugaas.in/v1/otp/verify \\
  -H "x-api-key: sk_prod_..." \\
  -H "content-type: application/json" \\
  -d '{ "email": "user@example.com", "code": "482913" }'

200 { "valid": true, "id": "8c1e...", "email": "user@example.com" }
200 { "valid": false, "reason": "invalid", "attempts_remaining": 3 }`;

const nodeSample = `const API = "https://api.swayammail.yugaas.in/v1/otp";
const headers = {
  "x-api-key": process.env.SWAYAMMAIL_API_KEY,
  "content-type": "application/json",
};

// When the user asks for a code
export async function sendOtp(email, ip) {
  const res = await fetch(API + "/send", {
    method: "POST",
    headers,
    body: JSON.stringify({ email, ip }),
  });
  return res.ok;
}

// When the user submits the code
export async function verifyOtp(email, code) {
  const res = await fetch(API + "/verify", {
    method: "POST",
    headers,
    body: JSON.stringify({ email, code }),
  });
  const { valid } = await res.json();
  return valid === true;
}`;

const handled = [
  { title: "Code generation", body: "We create a random code for every request. Asking for a new code cancels the previous one." },
  { title: "Safe storage", body: "Codes are stored only as hashes, so even we cannot read them back." },
  { title: "Expiry and single use", body: "Codes expire after 10 minutes and work once. Both are adjustable in OTP settings." },
  { title: "Wrong-attempt lockout", body: "A code locks after 5 wrong tries, which stops guessing attacks." },
  { title: "Rate limits", body: "One code per address per minute and 5 per hour, plus 20 per IP per hour when you pass the user's IP." },
  { title: "CAPTCHA", body: "Protect public forms with Cloudflare Turnstile or hCaptcha. We check the token before sending." },
  { title: "A fast lane", body: "OTP mail travels on its own queue, so codes never wait behind a marketing campaign." },
  { title: "Bounce protection", body: "If too many of your codes bounce, sending pauses before your domain reputation is hurt." },
];

const useCases = [
  { title: "Passwordless login", body: "Let users sign in with a code instead of remembering a password." },
  { title: "Signup email verification", body: "Confirm that a new user owns the address they typed." },
  { title: "Two-step verification", body: "Add a second check before sensitive actions such as payouts or password changes." },
  { title: "Fallback for SMS OTP", body: "Offer email when an SMS code does not arrive, without a second vendor." },
];

const faqs: Faq[] = [
  {
    q: "How do I send an OTP by email?",
    a: "Create a SwayamMail account, verify your sending domain and create an API key. Then POST the user's email address to /v1/otp/send. SwayamMail generates a one-time code and emails it. When the user types the code, POST it to /v1/otp/verify and you get back valid true or false.",
  },
  {
    q: "Do I need to generate or store OTP codes myself?",
    a: "No. SwayamMail generates the code, stores only a hash of it, tracks expiry and wrong attempts, and tells you whether the code a user typed is valid. Your database never holds an OTP.",
  },
  {
    q: "How long is an email OTP valid?",
    a: "By default a code is valid for 10 minutes, works once, and locks after 5 wrong attempts. You can change these in OTP settings.",
  },
  {
    q: "How much does it cost to send OTP by email?",
    a: "The free plan includes 1,000 emails a month. The Starter plan is ₹499 a month plus GST for 25,000 emails, which is about 2 paise per OTP. OTP emails count toward your normal monthly plan; there is no separate OTP fee.",
  },
  {
    q: "Is email OTP cheaper than SMS OTP in India?",
    a: "Usually, yes. SMS OTP in India is charged per message and needs DLT registration of your sender ID and templates. Email OTP needs neither: you verify your domain once and pay a flat monthly plan.",
  },
  {
    q: "How do I stop bots from abusing my OTP form?",
    a: "SwayamMail applies per-address and per-IP rate limits automatically, and can require a Cloudflare Turnstile or hCaptcha token before it sends a code. Turn CAPTCHA on in OTP settings and pass the token with each send request.",
  },
  {
    q: "Can I test OTP without sending real emails?",
    a: "Yes. Use a sandbox API key. Nothing is sent, and the response includes the code so you can test the full send and verify flow in development or CI.",
  },
  {
    q: "Which address do OTP emails come from?",
    a: "From an address on your own verified domain, set in OTP settings. Many teams use a subdomain such as otp.yourbrand.com so login codes are kept apart from marketing mail.",
  },
];

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "SwayamMail", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Email OTP API", item: `${SITE_URL}/email-otp-api` },
  ],
};

export default function EmailOtpApiPage() {
  return (
    <>
      <JsonLd data={faqJsonLd(faqs)} />
      <JsonLd data={breadcrumbJsonLd} />
      <MarketingNav />

      <main>
        <section className="mx-auto max-w-4xl px-5 pb-12 pt-16 text-center lg:pt-24">
          <p className="mb-5 inline-block rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-accent-dark">
            Email OTP API
          </p>
          <h1 className="font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">
            Send and verify OTP codes by email with two API calls.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            SwayamMail generates the one-time password, emails it to your user and checks it for you. No code to
            store, no expiry logic to write, no DLT registration.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={SIGNUP_HREF}
              className="rounded-lg bg-foreground px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-85"
            >
              Get a free API key
            </Link>
            <Link
              href="/docs#otp"
              className="rounded-lg border border-border bg-surface px-5 py-3 text-sm font-semibold hover:border-foreground"
            >
              Read the OTP docs
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted">Free for 1,000 emails a month. About 2 paise per OTP after that.</p>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="font-display text-3xl sm:text-4xl">How to send an OTP by email</h2>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-3 text-lg font-semibold">1. Send the code</h3>
              <p className="mb-4 text-sm leading-relaxed text-muted">
                Post the user&apos;s email address. We generate a code and deliver it in a plain email with the code in
                the subject line, so it is readable from the notification.
              </p>
              <CodeCard title="POST /v1/otp/send" code={sendSample} />
            </div>
            <div className="min-w-0">
              <h3 className="mb-3 text-lg font-semibold">2. Verify what the user typed</h3>
              <p className="mb-4 text-sm leading-relaxed text-muted">
                Post the address and the code. You get a clear yes or no, and a reason when it fails: invalid, expired,
                already used or too many attempts.
              </p>
              <CodeCard title="POST /v1/otp/verify" code={verifySample} />
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface-muted">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-3xl sm:text-4xl">Everything an OTP system needs, already built.</h2>
            <p className="mt-3 max-w-2xl text-muted">
              Writing OTP yourself means a codes table, hashing, expiry jobs, attempt counters and abuse limits. All
              of that is handled here.
            </p>
            <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
              {handled.map((item) => (
                <div key={item.title}>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl items-start gap-10 px-5 py-16 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl">Email OTP in Node.js</h2>
            <p className="mt-3 text-muted">
              The API is plain HTTPS and JSON, so it works from any language. Here is the whole integration in Node.js:
              one function to send, one to verify.
            </p>
            <h3 className="mt-8 text-lg font-semibold">What you can build</h3>
            <ul className="mt-4 space-y-4">
              {useCases.map((useCase) => (
                <li key={useCase.title} className="border-l-2 border-accent pl-4">
                  <p className="font-semibold">{useCase.title}</p>
                  <p className="mt-1 text-sm text-muted">{useCase.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <CodeCard title="otp.js" code={nodeSample} />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <div className="rounded-2xl border border-border bg-surface p-7 sm:flex sm:items-center sm:justify-between sm:gap-8">
            <div>
              <h2 className="font-display text-2xl">Email OTP pricing</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                OTP emails count toward your monthly plan with no extra fee: free for 1,000 emails a month, then ₹499
                plus GST for 25,000. The same account also sends your transactional and marketing email.
              </p>
            </div>
            <Link
              href="/pricing"
              className="mt-5 inline-block shrink-0 rounded-lg border border-border px-5 py-3 text-sm font-semibold hover:border-foreground sm:mt-0"
            >
              See all plans
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 pb-16">
          <h2 className="mb-8 text-center font-display text-3xl sm:text-4xl">Email OTP questions</h2>
          <FaqList faqs={faqs} />
        </section>

        <FinalCta
          title="Add email OTP to your app today."
          body="Create a free account, get a sandbox key and test the full flow before you send a single real email."
        />
      </main>

      <MarketingFooter />
    </>
  );
}
