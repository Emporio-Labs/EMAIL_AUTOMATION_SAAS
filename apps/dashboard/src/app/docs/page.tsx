import React from "react";

const navGroups = [
  {
    title: "Getting started",
    items: [
      { label: "Overview", href: "#overview" },
      { label: "Quickstart", href: "#quickstart" },
      { label: "Authentication", href: "#authentication" },
    ],
  },
  {
    title: "Core API",
    items: [
      { label: "API keys", href: "#api-keys" },
      { label: "Send emails", href: "#send-api" },
  { label: "Transactional API", href: "#transactional-api" },
  { label: "Webhooks", href: "#webhooks" },
      { label: "Transactional API", href: "#transactional-api" },
      { label: "Webhooks", href: "#webhooks" },
      { label: "Delivery status", href: "#delivery-status" },
      { label: "List sends", href: "#list-sends" },
      { label: "Sandbox behavior", href: "#sandbox" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "Errors", href: "#errors" },
      { label: "Rate limits", href: "#rate-limits" },
      { label: "Changelog", href: "#changelog" },
    ],
  },
];

const tocItems = [
  { label: "Overview", href: "#overview" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "Authentication", href: "#authentication" },
  { label: "API keys", href: "#api-keys" },
  { label: "Send emails", href: "#send-api" },
  { label: "Delivery status", href: "#delivery-status" },
  { label: "List sends", href: "#list-sends" },
  { label: "Sandbox behavior", href: "#sandbox" },
  { label: "Errors", href: "#errors" },
  { label: "Rate limits", href: "#rate-limits" },
  { label: "Changelog", href: "#changelog" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-foreground text-sm font-semibold text-background">
              SM
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted">SwayamMail</p>
              <p className="font-display text-lg">Developer Docs</p>
            </div>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <label className="relative">
              <span className="sr-only">Search docs</span>
              <input
                className="h-10 w-56 rounded-full border border-border bg-surface-muted px-4 text-xs text-foreground outline-none focus:border-accent"
                placeholder="Search docs"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted">
                Ctrl K
              </span>
            </label>
            <a
              href="/pricing"
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted transition hover:bg-surface-muted"
            >
              Pricing
            </a>
            <a
              href="/signin"
              className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:opacity-80"
            >
              Sign in
            </a>
          </div>
        </div>
      </header>

      <div className="bg-[radial-gradient(circle_at_top,_#e7f4ec,_#f7f6f1_60%)]">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="rounded-3xl border border-border bg-surface/80 px-6 py-8 card-shadow fade-in">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Documentation</p>
                <h1 className="font-display mt-2 text-4xl text-foreground">Ship reliable email in days, not weeks.</h1>
                <p className="mt-3 max-w-2xl text-sm text-muted">
                  Public developer documentation for integrating with the SwayamMail API. Learn how to create API keys,
                  authenticate requests, and send email safely using sandbox and production keys.
                </p>
              </div>
              <div className="grid gap-2 text-xs text-muted">
                <div className="rounded-full border border-border bg-surface-muted px-4 py-2">
                  Base URL: <span className="font-mono">http://localhost:3000</span>
                </div>
                <div className="rounded-full border border-border bg-surface-muted px-4 py-2">
                  Version: <span className="font-semibold text-foreground">v0.4 beta</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 pb-16 pt-6 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl border border-border bg-surface px-4 py-5 card-shadow">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Browse</p>
            <div className="mt-4 flex flex-col gap-6">
              {navGroups.map((group) => (
                <div key={group.title}>
                  <p className="text-xs font-semibold uppercase text-foreground">{group.title}</p>
                  <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <a className="transition hover:text-foreground" href={item.href}>
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <article className="flex flex-col gap-10">
          <section id="overview" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in">
            <h2 className="font-display text-2xl text-foreground">Overview</h2>
            <p className="mt-2 text-sm text-muted">
              SwayamMail exposes a developer API for sending email. Use API keys in the
              <span className="font-mono text-xs"> x-api-key</span> header and choose between sandbox and production keys
              depending on your testing needs.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Auth</p>
                <p className="mt-2 text-sm text-foreground">API keys via <span className="font-mono">x-api-key</span> header.</p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Verification</p>
                <p className="mt-2 text-sm text-foreground">Production keys require a verified domain and approved From address.</p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Sandbox</p>
                <p className="mt-2 text-sm text-foreground">Test keys mark jobs delivered without touching SES.</p>
              </div>
            </div>
          </section>

          <section id="quickstart" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow fade-in-delay-1">
            <h2 className="font-display text-2xl text-foreground">Quickstart</h2>
            <ol className="mt-4 grid gap-4 text-sm text-muted md:grid-cols-2">
              <li className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 1</p>
                <p className="mt-2 text-foreground">Create a sending domain and publish DNS records.</p>
              </li>
              <li className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 2</p>
                <p className="mt-2 text-foreground">Approve From addresses under the verified domain.</p>
              </li>
              <li className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 3</p>
                <p className="mt-2 text-foreground">Issue API keys for sandbox and production.</p>
              </li>
              <li className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Step 4</p>
                <p className="mt-2 text-foreground">Send your first email using <span className="font-mono">POST /v1/send</span>.</p>
              </li>
            </ol>
          </section>

          <section id="authentication" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Authentication</h2>
            <div className="mt-4 rounded-2xl border border-border bg-surface-muted px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Developer API</p>
              <p className="mt-2 text-sm text-foreground">Authenticate by sending your API key in the header.</p>
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`x-api-key: sk_test_...`}
              </pre>
            </div>
          </section>

          <section id="api-keys" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">API keys</h2>
            <p className="mt-2 text-sm text-muted">
              Create up to 5 active keys per tenant in the dashboard. Keys are shown once on creation and stored as hashes.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Create key</p>
                <p className="mt-2 text-sm text-foreground">Go to the Dashboard → API keys to create a new key.</p>
                <div className="mt-3 rounded-full border border-border bg-surface px-3 py-1 text-xs font-mono text-muted">
                  sk_test_... / sk_prod_...
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">List keys</p>
                <p className="mt-2 text-sm text-foreground">Manage keys inside the dashboard UI.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Revoke key</p>
                <p className="mt-2 text-sm text-foreground">Use the dashboard to revoke a compromised key.</p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Preview</p>
                <p className="mt-2 text-sm text-foreground">Store only the preview in logs.</p>
                <div className="mt-3 rounded-full border border-border bg-surface px-3 py-1 text-xs font-mono text-muted">
                  ...x9k2
                </div>
              </div>
            </div>
          </section>

          <section id="send-api" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Send emails</h2>
            <p className="mt-2 text-sm text-muted">
              Send to direct emails, contact IDs, or list IDs. You must provide at least one recipient array.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`POST /v1/send

{
  "from": "hello@yourdomain.in",
  "subject": "Welcome to SwayamMail",
  "html": "<h1>Hello there</h1>",
  "toEmails": ["customer@example.com"],
  "contactIds": [],
  "listIds": []
}`}
            </pre>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Response</p>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`{
  "accepted": 1,
  "jobIds": ["f7d..."],
  "publishedJobs": []
}`}
                </pre>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Headers</p>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`x-api-key: sk_prod_...`}
                </pre>
              </div>
            </div>
          </section>

          <section id="transactional-api" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Transactional email API</h2>
            <p className="mt-2 text-sm text-muted">
              For reports, invoices and other one-to-one mail sent from your own app or dashboard. You send ready-made HTML;
              no unsubscribe footer is added and links are not rewritten. Opens are tracked if your plan includes it
              (set <span className="font-mono text-xs">track_opens: false</span> to skip). Files are sent as links and shown
              as attachment cards at the bottom of the email. Send an <span className="font-mono text-xs">Idempotency-Key</span>
              header so a retried request never sends twice.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`POST /v1/emails
x-api-key: sk_prod_...
Idempotency-Key: report-acme-2026-10

{
  "from": "Agency Reports <reports@yourdomain.in>",
  "to": ["client@acme.com"],
  "cc": ["pm@yourdomain.in"],
  "reply_to": "pm@yourdomain.in",
  "subject": "Your October report",
  "html": "<h1>October at a glance</h1>...",
  "text": "October at a glance...",
  "attachments": [
    { "filename": "Invoice-Oct.pdf", "url": "https://files.yourdomain.in/inv-oct.pdf" }
  ],
  "tags": { "client": "acme", "kind": "monthly-report" }
}`}
            </pre>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Response (202)</p>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`{
  "id": "f7d1...",
  "status": "queued",
  "to": ["client@acme.com"],
  "subject": "Your October report",
  "tags": { "client": "acme" }
}`}
                </pre>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Other endpoints</p>
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`POST /v1/emails/batch
{ "emails": [ {...}, {...} ] }   // up to 100

GET /v1/emails/:id
// status, timestamps and event history`}
                </pre>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              Limits: 50 recipients across to/cc/bcc, 200 KB of HTML, 10 attachment links, 10 tags. Reusing an
              Idempotency-Key with the same body returns the original email (HTTP 200); with a different body it returns 409.
              In a batch, item <span className="font-mono text-xs">i</span> uses key <span className="font-mono text-xs">&lt;key&gt;:i</span>.
            </p>
          </section>

          <section id="webhooks" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Webhooks</h2>
            <p className="mt-2 text-sm text-muted">
              Set one URL per account under Webhooks in the dashboard. Events: <span className="font-mono text-xs">email.sent</span>,
              <span className="font-mono text-xs"> email.delivered</span>, <span className="font-mono text-xs">email.bounced</span>,
              <span className="font-mono text-xs"> email.complained</span>, <span className="font-mono text-xs">email.opened</span>,
              <span className="font-mono text-xs"> email.clicked</span>, <span className="font-mono text-xs">email.failed</span>.
              Respond with any 2xx within 10 seconds. Other responses are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`POST https://your-app.com/webhooks/swayam
Swayam-Event: email.delivered
Swayam-Delivery-Id: 0b6e...
Swayam-Signature: t=1761815000,v1=5f2c...

{
  "id": "0b6e...",
  "type": "email.delivered",
  "created_at": "2026-10-30T09:30:00Z",
  "data": {
    "email_id": "f7d1...",
    "from": "reports@yourdomain.in",
    "to": ["client@acme.com"],
    "subject": "Your October report",
    "email_type": "transactional",
    "tags": { "client": "acme" },
    "details": { "email": "client@acme.com" }
  }
}`}
            </pre>
            <p className="mt-4 text-sm text-muted">Verify the signature before trusting a request (Node.js):</p>
            <pre className="mt-2 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`const [t, v1] = header.split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", WEBHOOK_SECRET)
  .update(\`\${t}.\${rawBody}\`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
const valid = fresh && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));`}
            </pre>
          </section>

          <section id="delivery-status" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Delivery status</h2>
            <p className="mt-2 text-sm text-muted">
              Check a single send by job ID. Responses omit HTML for privacy.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`GET /v1/sends/:jobId`}
            </pre>
            <div className="mt-4 rounded-2xl border border-border bg-surface-muted px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Response</p>
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`{
  "jobId": "uuid",
  "status": "delivered",
  "to": "user@example.com",
  "from": "hello@yourdomain.in",
  "subject": "Welcome",
  "createdAt": "2026-04-29T13:00:00Z",
  "sentAt": "2026-04-29T13:00:02Z",
  "failedAt": null
}`}
              </pre>
            </div>
          </section>

          <section id="list-sends" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">List sends</h2>
            <p className="mt-2 text-sm text-muted">
              Fetch recent sends with filters. Supports <span className="font-mono">status</span>, <span className="font-mono">to</span>,
              <span className="font-mono"> from</span>, <span className="font-mono">subject</span>, <span className="font-mono">startDate</span>,
              <span className="font-mono"> endDate</span>, <span className="font-mono">page</span>, and <span className="font-mono">limit</span>.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`GET /v1/sends?status=delivered&limit=20&page=1`}
            </pre>
            <div className="mt-4 rounded-2xl border border-border bg-surface-muted px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted">Response</p>
              <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-3 text-xs text-[#e6f7ef]">
{`{
  "page": 1,
  "limit": 20,
  "total": 120,
  "items": [
    {
      "jobId": "uuid",
      "status": "queued",
      "to": "user@example.com",
      "from": "hello@yourdomain.in",
      "subject": "Welcome",
      "createdAt": "2026-04-29T13:00:00Z",
      "sentAt": null,
      "failedAt": null
    }
  ]
}`}
              </pre>
            </div>
          </section>

          <section id="sandbox" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Sandbox behavior</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">sk_test_</p>
                <p className="mt-2 text-sm text-foreground">Jobs are marked delivered immediately. No SQS, no SES.</p>
                <div className="mt-3 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-dark">
                  sandbox: true
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">sk_prod_</p>
                <p className="mt-2 text-sm text-foreground">Jobs are queued and delivered via SES.</p>
                <div className="mt-3 rounded-full bg-[#fff7e6] px-3 py-1 text-xs font-semibold text-[#a87412]">
                  status: queued
                </div>
              </div>
            </div>
          </section>

          <section id="errors" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Errors</h2>
            <p className="mt-2 text-sm text-muted">Errors return JSON with an <span className="font-mono">error</span> field and optional details.</p>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-[#101915] px-4 py-4 text-xs text-[#e6f7ef]">
{`{
  "error": "Invalid payload",
  "issues": {
    "fieldErrors": {
      "from": ["Invalid email"]
    }
  }
}`}
            </pre>
          </section>

          <section id="rate-limits" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Rate limits</h2>
            <p className="mt-2 text-sm text-muted">
              Beta limits are generous. If you receive <span className="font-mono">429</span>, reduce send throughput or reach out for a
              higher allowance.
            </p>
          </section>

          <section id="changelog" className="scroll-mt-28 rounded-3xl border border-border bg-surface px-6 py-7 card-shadow">
            <h2 className="font-display text-2xl text-foreground">Changelog</h2>
            <div className="mt-4 grid gap-4">
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">April 2026</p>
                <p className="mt-2 text-sm text-foreground">Added API keys with sandbox mode and production prefixes.</p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-muted px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted">March 2026</p>
                <p className="mt-2 text-sm text-foreground">Domain verification flow and sending addresses released.</p>
              </div>
            </div>
          </section>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl border border-border bg-surface px-4 py-5 card-shadow">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">On this page</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-muted">
              {tocItems.map((item) => (
                <li key={item.href}>
                  <a className="transition hover:text-foreground" href={item.href}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
