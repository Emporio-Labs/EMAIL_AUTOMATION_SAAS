# SwayamMail — Complete Project Context Document

> This document captures the full context of the SwayamMail project — every architectural decision, product discussion, technical choice, naming decision, market analysis, and open question discussed so far. Anyone reading this should be able to pick up exactly where we left off without needing any prior context.

---

## 1. Who Is Building This

**Founder:** Sagun Varma
- Final-year B.Tech CSE (Data Science), Institute of Aeronautical Engineering, Hyderabad (graduating 2026)
- Non-technical founder — handles sales, marketing, orchestration, and product decisions
- Does NOT write code himself. Delegates all technical work to a managed team
- Operating model: delivery manager, not developer

**The broader context:**
Sagun runs multiple ventures simultaneously under the brand **Yugaas** (web/software delivery). SwayamMail is a new SaaS product being incubated alongside:
- **WrenchCloud** — garage/auto sector SaaS (3 active Hyderabad clients)
- **ChatPlug.ai** — multi-tenant RAG chatbot SaaS (production-grade FastAPI backend built)
- **Hybrid Human** — wellness platform for client Rahul (Fitflix)

SwayamMail is being built as a standalone product under a new brand, not under Yugaas.

---

## 2. What SwayamMail Is

SwayamMail is an **India-first, developer-focused transactional email SaaS** built on top of Amazon SES.

### The one-line pitch:
> "The email platform for SaaS builders — send transactional emails, build AI-powered workflows, and launch campaigns. All from one API."

### The problem it solves:
- Indian SaaS founders and developers currently pay US dollar pricing to Resend, Postmark, or SendGrid
- None of these tools have AI-native features (writer, template generation)
- None have a proper visual workflow builder
- None support Razorpay billing
- The market has a clear gap: **transactional reliability + AI content generation + visual workflow builder** combined in one product at Indian pricing

### Core differentiators:
1. **AI email writer** — describe what you want, get a complete email
2. **AI template generation** — prompt to pixel-perfect HTML email template
3. **Visual workflow builder** — drag-and-drop multi-step email flows
4. **Webhook-triggered flows** — fire a webhook from anywhere, trigger an email sequence
5. **Automated campaigns**
6. **India-first pricing** in INR via Razorpay
7. **Built on AWS SES** — highest deliverability, lowest infra cost

---

## 3. The Name

### Original name considered: Enveloop
- Discovered during research that **Enveloop is already a funded company** (founded 2021) — completely taken
- Domain `enveloop.com` is down but company exists

### Current working name: **SwayamMail**
- Domain: `swayammail.com` — needs to be verified on [instantdomainsearch.com](https://instantdomainsearch.com)
- Founder's honest note: "Swayam" = self/autonomous in Hindi, not strong SaaS-product energy
- This is a **placeholder name** — branding to be finalized later
- Alternative names shortlisted: Mailwyre, Lettrd, Fluxmail, Mailvolt, Trigmail, Postflow

### Recommendation from advisor:
**Mailvolt** — unique, not taken, hints at speed and power, `mailvolt.io` likely available, easy to say and remember.

---

## 4. The Architecture — Full Technical Design

SwayamMail is built as **two completely separate services**. This is a deliberate architectural decision, not an accident.

---

### Why Two Services?

The cleanest architecture keeps business logic and throughput concerns separated:

```
Business logic, APIs, tenant rules  →  TypeScript (Service 1)
High throughput, queue consumer     →  Go (Service 2)
```

**Rejected option:** Having the Go service receive client requests directly — Go's advantage is concurrency at scale (goroutines), not handling REST APIs with business rules. TypeScript/Fastify is faster to build, maintain, and hire for when it comes to CRUD + business logic.

**Rejected option:** Having a Go middleware between TS API and SQS — this is a pointless extra hop with no benefit.

---

### The Complete Architecture Flow

```
Client / Tenant App
        │
        │  POST /v1/send { apiKey, from, to[], subject, html }
        ▼
┌─────────────────────────────────────────────────────────┐
│           SERVICE 1 — TypeScript API (Fastify)           │
│                                                         │
│  1. Validate API key → identify tenant                  │
│  2. Check rate limit in Redis (per tenant, per plan)    │
│  3. Verify sending domain is SPF/DKIM/DMARC verified    │
│  4. Filter suppressed addresses from to[] array         │
│  5. For each remaining address:                         │
│     a. Generate jobId (UUID)                            │
│     b. INSERT into email_jobs (status: queued)          │
│     c. Publish one message to SQS                       │
│  6. Return { accepted, rejected, jobIds }               │
└────────────────────────┬────────────────────────────────┘
                         │
              One job per email
              { jobId, tenantId, from, to, subject, html }
                         │
                         ▼
              ┌─────────────────┐
              │   Amazon SQS    │
              │  email-jobs     │
              │  + DLQ          │
              └────────┬────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│        SERVICE 2 — Go Worker (ECS Fargate)               │
│                                                         │
│  - Poll SQS (long poll, 20s wait)                       │
│  - Spawn one goroutine per message                      │
│  - Send via AWS SES                                     │
│  - On success: UPDATE DB status, DELETE SQS message     │
│  - On failure: do NOT delete → SQS retries after 60s   │
│  - After 3 failures: SQS auto-moves to DLQ             │
│  - Auto-scales on SQS queue depth (ECS policy)         │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
                   Amazon SES
                         │
                SNS bounce/complaint
                         │
                         ▼
         Back to TS API /webhooks/sns
         → INSERT into suppressed table
         → POST to tenant's webhook_url
```

---

### SQS Configuration (Decided and Deployed)

| Setting | Value | Reason |
|---|---|---|
| Type | Standard | Order not critical, maximum throughput |
| Queue name | `email-jobs` | Main queue |
| Visibility timeout | 60 seconds | Gives Go worker time to complete SES send |
| Message retention | 4 days | Buffer for outages |
| Receive wait time | 20 seconds | Long polling — saves SQS cost |
| Max message size | 256 KB | Sufficient for HTML payloads |
| DLQ | `email-jobs-dlq` | Catches jobs that fail 3+ times |
| Max receives before DLQ | 3 | Retry twice, then escalate |

**Important note on 256KB limit:** If HTML templates are large, store HTML in S3 and include only the S3 key in the SQS message. Go worker fetches HTML from S3 before sending. Not needed now — add when you hit the limit.

---

### Why NOT RabbitMQ / Amazon MQ

During setup, the founder started setting up Amazon MQ (RabbitMQ on AWS). This was stopped immediately.

**Decision: Use SQS, not RabbitMQ.**

Reasons:
- SQS is already AWS-native — zero ops overhead
- RabbitMQ on Amazon MQ requires managing broker health, cluster mode decisions, and costs 3x more
- SQS has native DLQ, retry logic, and auto-scales
- The only advantage of RabbitMQ (advanced routing) is not needed here

**Can Go channels replace SQS entirely?**
No. Go's buffered channels are in-memory only. If the process crashes, every job in the channel is gone. For a paid email service where tenants pay per send, losing jobs is unacceptable. The correct pattern is:

```
SQS (durability + retry) → Go channels (concurrency inside worker)
```

Use SQS for job persistence. Use Go goroutines for parallel processing within the worker. Best of both.

---

### SQS Message Payload

Every message in SQS contains the full payload needed to send the email. The Go worker is stateless — it cannot call back to the TS API. Everything must be in the message.

```json
{
  "jobId": "uuid",
  "tenantId": "uuid",
  "from": "hello@yourdomain.com",
  "to": "user@example.com",
  "subject": "Welcome",
  "html": "<h1>Hello</h1>"
}
```

---

### Go Worker Folder Structure

```
email-worker/
├── main.go
├── .env
├── config/
│   └── config.go        # Load and validate env vars
├── queue/
│   └── sqs.go           # Poll SQS, delete messages
├── mailer/
│   └── ses.go           # Send email via AWS SES
├── db/
│   └── postgres.go      # Update job status
├── worker/
│   └── worker.go        # Core loop — ties everything together
└── models/
    └── job.go           # EmailJob struct
```

The worker is intentionally dumb. No business logic lives here. All rules (rate limits, suppression, domain checks) live in Service 1.

---

### Database Schema

```sql
-- All tenants using the platform
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'starter',
  rate_limit  INT NOT NULL DEFAULT 20,
  webhook_url TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Verified sending domains per tenant
CREATE TABLE domains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  domain      TEXT NOT NULL,
  verified    BOOLEAN DEFAULT FALSE,
  dkim_record TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Suppressed email addresses (bounced or complained)
CREATE TABLE suppressed (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  email       TEXT NOT NULL,
  reason      TEXT NOT NULL,  -- 'bounce' or 'complaint'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- Individual email job tracking
CREATE TABLE email_jobs (
  job_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  from_email  TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  subject     TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued | delivered | failed
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);
```

---

### Infrastructure Stack

| Component | Service | Notes |
|---|---|---|
| TS API | ECS Fargate | Currently t3.medium (was t3.micro — being upgraded) |
| Go Worker | ECS Fargate | Auto-scales based on SQS queue depth |
| Queue | Amazon SQS | email-jobs + email-jobs-dlq |
| Email | Amazon SES | Transactional, production access pending |
| Bounce events | Amazon SNS | Fires to TS API webhook endpoint |
| Database | RDS PostgreSQL | Jobs, tenants, suppressed addresses |
| Cache | ElastiCache Redis | Rate limiting counters per tenant |
| Billing | Razorpay | India-first |
| Region | ap-south-1 Mumbai | All services in same region |

---

### TS API Endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/v1/send` | Send emails — explodes array into individual SQS jobs |
| GET | `/v1/status/:jobId` | Get delivery status of a job |
| POST | `/v1/domains/verify` | Start domain verification for tenant |
| GET | `/v1/domains` | List verified domains |
| POST | `/webhooks/sns` | Receive bounce/complaint events from SES via SNS |

---

## 5. Unsubscribe — How It Works

During discussion, a real email from Eventbrite was shown where Gmail displayed a one-click **Unsubscribe** button next to the sender name. This is not magic — it requires specific email headers.

### How Gmail shows the Unsubscribe button

Two headers must be present in every outgoing email:

```
List-Unsubscribe: <https://swayammail.com/unsub?t=UNIQUE_TOKEN>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Gmail renders the button automatically when these headers are present.

### What needs to be built

**In TS API (before publishing to SQS):**
- Generate a unique unsubscribe token per recipient per tenant
- Store: `{ token, tenantId, email }` in DB
- Inject the two headers into the SQS message payload

**In Go Worker (when calling SES):**
- Include headers in the SES SendEmail call

**New endpoint in TS API:**
```
GET /unsub?t=TOKEN
→ mark email as suppressed for that tenant
→ show "You've been unsubscribed" page
```

### Why this is non-negotiable
Since 2024, **Gmail and Yahoo both require one-click unsubscribe** for bulk senders. Without it, emails are routed to spam or blocked. This must be built in Phase 1, not later.

---

## 6. Dedicated IP and Primary Inbox — Explained

### What is a Dedicated IP?

By default, SES sends your emails from shared IPs used by thousands of AWS customers. A dedicated IP is an IP address used exclusively by your account.

```
Shared IP:   your emails + other senders' emails → same IP reputation
Dedicated IP: only your emails → you own the reputation entirely
```

**Cost:** $25/month per IP on SES.

**When to use it:** Only when a single tenant sends 100k+ emails/month consistently. Do NOT use dedicated IPs at launch — you'll start with zero reputation and emails will land in spam until the IP is "warmed up."

### What is IP Warmup?

A fresh dedicated IP has no reputation. Gmail and other providers will be suspicious of it. Warmup means starting slow and increasing volume gradually:

```
Day 1:   200 emails
Day 2:   400 emails
Day 3:   800 emails
...continues doubling for 30-45 days
```

This teaches inbox providers the IP is legitimate before blasting full volume.

### What is Primary Inbox?

Gmail shows multiple tabs:
```
Primary | Promotions | Social | Updates | Spam
```

"Primary inbox" = the main tab. Where people actually read emails. Promotions tab has 5-10% open rates. Spam is dead.

Good IP reputation + proper domain authentication (SPF/DKIM/DMARC) + good sending practices = Primary inbox placement.

**Current stance:** Use SES shared IPs at launch. Amazon pre-warms and maintains these. Move to dedicated IPs only when tenant volume demands it.

---

## 7. Bounce and Complaint Handling

This is the #1 technical risk. If ignored, SES suspends your account and all tenants go down.

### SES thresholds (hard limits):
- **Bounce rate above 2%** → SES sends warning, may pause sending
- **Complaint rate above 0.1%** → Immediate action required

### The flow:
```
Email sent via SES
        ↓
Recipient server rejects email (bounce) 
OR recipient marks as spam (complaint)
        ↓
SES fires SNS event
        ↓
SNS calls POST /webhooks/sns on TS API
        ↓
TS API inserts address into suppressed table
        ↓
TS API fires tenant's registered webhook_url with event data
        ↓
Future sends to this address blocked at suppression check (step 4 of pipeline)
```

### What gets suppressed:
- **Hard bounce** = email doesn't exist → suppress permanently
- **Soft bounce** = mailbox full, temporary → can retry, but monitor
- **Complaint** = marked as spam → suppress permanently

---

## 8. Market Research and Positioning

### Competitor landscape

| Player | Strength | Weakness |
|---|---|---|
| Resend | Modern dev experience, React Email, deep JS alignment | No AI, no workflow builder, USD pricing |
| Postmark | Fastest delivery, transactional focus, 97%+ inbox | No drag-and-drop, no marketing features |
| SendGrid | High volume, big brand | Steep learning curve, features locked to higher tiers |
| Mailgun | Dev-friendly, good docs | Dated dashboard, deliverability needs tuning |
| Brevo | All-in-one (transactional + marketing + CRM + SMS) | Not developer-first, feels bloated |
| Amazon SES | Cheapest at $0.10/1000 emails | Bare metal — no dashboard, no DX |

### The gap in the market

Nobody has combined these three things well:
```
Transactional reliability  +  AI content generation  +  Visual workflow builder
      (Postmark/Resend)           (nobody yet)              (nobody in email)
```

### Positioning statement
> "The email platform for SaaS builders — send transactional emails, build AI-powered workflows, and launch campaigns. All from one API."

### Target customer
Non-technical SaaS founders and indie hackers who need transactional emails AND campaign automation without the complexity of Resend + Brevo combined.

### India-first pricing advantage
- Resend Pro: $20/month for 50k emails = ~₹1,650
- SwayamMail Starter: ₹999/month for 50k emails
- Same AWS SES infrastructure underneath
- Razorpay billing (no USD conversion, no international card needed)

### Feature comparison

| Feature | SwayamMail | Resend | Postmark | SendGrid |
|---|---|---|---|---|
| Transactional API | ✓ | ✓ | ✓ | ✓ |
| AI email writer | ✓ | — | — | — |
| AI template generation | ✓ | — | — | — |
| Visual workflow builder | ✓ | — | — | Partial |
| Webhook-triggered flows | ✓ | Partial | Partial | — |
| Auto campaigns | ✓ | — | — | ✓ |
| India pricing (₹) | ✓ | — | — | — |
| Razorpay billing | ✓ | — | — | — |

---

## 9. Pricing Structure

| Plan | Price | Emails/month | AI Credits | Workflows |
|---|---|---|---|---|
| Free | ₹0 | 3,000 | 10 | 2 |
| Starter | ₹999/mo | 50,000 | 100 | 10 |
| Pro | ₹3,999/mo | 300,000 | Unlimited | Unlimited |
| Scale | Custom | Custom | Custom | Custom |

### Unit economics
- AWS SES cost: $0.10 per 1,000 emails = ~₹8 per 1,000
- 50,000 emails costs ~₹400 in SES fees
- Starter plan at ₹999 = ~₹599 gross margin on emails alone
- Pro plan at ₹3,999 for 300k emails = ₹2,400 SES cost = ₹1,599 gross margin on emails
- AI generation costs (Claude/GPT API) must be factored into Pro tier margin

### Breakeven math
- Estimated monthly burn: ₹3–4L (team + infra)
- Average ARPU: ~₹2,000
- Paying customers needed to breakeven: ~200
- This is the North Star number for Year 1

---

## 10. Risk Analysis

### The 3 Existential Risks (in order of severity)

**1. Deliverability failure**
- Probability: High (if not managed proactively)
- Impact: Catastrophic — SES suspends account, all tenants go down
- Fix: Force SPF/DKIM/DMARC before any tenant sends. Auto-suspend tenants above 2% bounce rate. Enable AWS SES Virtual Deliverability Manager (VDM). Never allow unverified domains.

**2. Low adoption / no paying customers**
- Probability: High (market education required)
- Impact: Burn through runway
- Fix: Do NOT launch publicly first. Get 5–10 pilot customers manually. Charge them even at discounted rate. Fix everything that confuses them. Only then open to public.

**3. Feature creep before core works**
- Probability: Almost certain (temptation is real)
- Impact: 4 devs spread thin, nothing works well
- Fix: Phase 1 is complete only when 10 paying tenants have 90%+ inbox delivery. AI templates come after. Workflow builder is month 6 minimum.

### Other risks

| Risk | Level | Mitigation |
|---|---|---|
| Infrastructure outage | Medium | Multi-AZ, health checks, DLQ monitoring |
| Support overload | Medium | Self-serve docs, automated dashboards |
| Legal (DPDP Act) | Low-Medium | Explicit opt-in, unsubscribe in every email |
| Abuse (spam through platform) | High | No free tier at launch, manual approval, rate limits |
| Cash burn | Medium | AWS Activate credits ($200 for startups), keep infra under ₹10k/month until 50 customers |

### The core principle
> **Be India's most reliable email engine, not India's cheapest Mailchimp.**

Reliability retains customers. Price acquires them. Build reliability first.

---

## 11. Phased Roadmap

### Phase 1 — Launch (Now, ~6–8 weeks)
- [ ] API key auth + tenant isolation
- [ ] Redis rate limiting per tenant per plan
- [ ] Domain verification (SPF/DKIM/DMARC)
- [ ] Bounce/complaint handling via SNS
- [ ] Unsubscribe headers in every email
- [ ] Auto-suppression of bounced/complained addresses
- [ ] Basic dashboard — sends, bounces, status per tenant
- [ ] DLQ monitoring and alerting
- **Done when:** 10 paying tenants sending with 90%+ inbox delivery

### Phase 2 — AI (Month 3)
- [ ] AI email writer (Claude/GPT API)
- [ ] AI template generation from prompt
- [ ] Template library with versioning
- [ ] Razorpay billing integration
- [ ] Usage analytics per tenant

### Phase 3 — Workflows (Month 6)
- [ ] Visual workflow builder (drag-and-drop)
- [ ] Webhook-triggered flows
- [ ] Condition nodes (if/else branching)
- [ ] Automated campaigns with scheduling
- [ ] Dedicated IP support for high-volume tenants

---

## 12. SES Production Access

SES starts in sandbox mode — very limited sending (1 email/second, 200/day, only to verified addresses). Production access must be requested to AWS.

### Status
- Production access request: **Submitted / In progress**
- Mail type selected: **Transactional** (correct choice — even though platform supports campaigns, the per-job sending behavior is transactional)
- Website URL used: **GitHub Pages placeholder** (no domain purchased yet — founder is bootstrapped)

### GitHub Pages setup for SES request
Since no domain was available, a GitHub Pages URL (`yourusername.github.io/swayammail`) was used as the website URL in the SES production request. AWS does not verify it immediately — they just need to see something real exists.

---

## 13. Assets Created So Far

| Asset | Description |
|---|---|
| `README.md` | Full technical README with Mermaid diagrams — architecture, data flows, DB schema, ER diagram, Gantt roadmap, env vars |
| `index.html` | Landing page (clean minimal design — Linear/Vercel aesthetic) with hero, features, architecture diagram, pricing, comparison table, CTA |

### Landing page design decisions
- **Design direction:** Clean and minimal — NOT dark/cyberpunk, NOT purple gradients, NOT AI-slop aesthetic
- **Aesthetic reference:** Linear, Resend, Vercel — sharp typography, white space, restrained
- **Fonts:** Fraunces (serif display) + Geist (sans body) + Geist Mono (code/labels)
- **Color palette:** Near-white background (#fafafa), near-black text (#111110), green accent for live/status indicators
- **Key sections:** Nav, Hero + code preview, Logos (built on...), Features (6 cards), How it works (4 steps), Architecture table, Pricing (4 plans), Comparison table, CTA, Footer
- **Branding note:** SwayamMail is a placeholder. Brand identity to be finalized after domain decision.

---

## 14. Key Technical Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Queue technology | SQS (not RabbitMQ) | AWS-native, zero ops, native DLQ, auto-retry |
| Service 1 language | TypeScript (Fastify) | Faster for business logic, easier to maintain, better DX |
| Service 2 language | Go | Goroutines for concurrent SES sends, high throughput |
| Client-facing API language | TypeScript (not Go) | Go's advantage is throughput, not REST API business rules |
| SQS type | Standard (not FIFO) | Email order doesn't matter, standard has higher throughput |
| SQS visibility timeout | 60 seconds | Enough for SES send to complete before message re-appears |
| SQS long poll | 20 seconds | Reduces SQS polling cost significantly |
| Job granularity | One email = one SQS message | Allows individual retry, tracking, and failure isolation |
| HTML in SQS | Yes (up to 256KB) | Worker is stateless — needs full payload. Use S3 if >256KB |
| Bounce handling | SNS → TS API webhook | AWS-native, reliable, automatic |
| Dedicated IPs | Not yet | Shared SES IPs are pre-warmed. Add dedicated IPs at scale |
| SES mail type | Transactional | Correct even for campaigns — individual job behavior |
| Region | ap-south-1 Mumbai | Lowest latency for Indian users |

---

## 15. Immediate Next Steps

1. **Finish Go worker** — poll SQS, call SES, update DB, handle retries
2. **Build TS API** — auth, rate limiting, domain verification, SQS publish
3. **Wire SNS bounce/complaint** → suppression table → tenant webhook
4. **Add unsubscribe headers** to every outgoing email
5. **Get SES production access** approved (request submitted)
6. **Get 5 pilot customers** manually — hand-hold onboarding
7. **Decide on final brand name** and buy domain when first revenue comes in

---

## 16. Open Questions

- Final brand name not decided (SwayamMail is placeholder)
- Domain not purchased yet (bootstrapped, no money currently)
- AI provider not chosen (Claude vs GPT-4o for email writer feature in Phase 2)
- Frontend dashboard not started (needed for tenants to see analytics)
- Razorpay integration not started (needed before public launch)

---

*Document created: April 28, 2026*
*Based on: Full architectural discussion, market research, technical decisions, and product strategy sessions*
*Next chat can pick up from Section 15 — Immediate Next Steps*
