# SwayamMail 📬
> **The email platform for SaaS builders.** Send transactional emails, manage automated campaigns, and verify sender domains — all from one clean, developer-first API.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-5.0-lightgrey.svg)](https://expressjs.com/)
[![AWS SES](https://img.shields.io/badge/AWS%20SES-v2-orange.svg)](https://aws.amazon.com/ses/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-emerald.svg)](https://supabase.com/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

SwayamMail (working title: *Mailvolt*) is an India-first, developer-focused transactional email SaaS built on top of Amazon SES. It is designed to combine the modern developer experience of Resend, the high deliverability of Postmark, and visual/automated campaign tools — delivered at highly competitive INR-native pricing via Razorpay integration.

---

## ⚡ Key Features

- **Transactional API**: Quick and reliable single or bulk email delivery.
- **Domain Verification**: Multi-tenant SPF, DKIM, and DMARC verification helper setup for tenant custom domains.
- **Auto-Suppressions**: Auto-handles bounces and complaints via AWS SNS webhook to protect your sending reputation.
- **Unsubscribe System**: Complies with Gmail/Yahoo bulk sender requirements by embedding one-click unsubscribe headers automatically (`List-Unsubscribe` & `List-Unsubscribe-Post`).
- **Campaign Management**: Snapshot-based recipient lists, campaign contact management, and contact subscription states.
- **Interactive Dashboard**: Modern Next.js application for managing domains, API keys, campaigns, and tracking analytics.

---

## 🏗️ System Architecture

SwayamMail divides concerns into two separate services to maximize scalability, high throughput, and reliable job persistence.

```
Client / Tenant Application
        │
        │ (POST /v1/send)
        ▼
┌────────────────────────────────────────────────────────┐
│          SERVICE 1 — TypeScript API (Express)          │
│  - Multi-tenant auth & API keys validation            │
│  - Rate-limiting checking (tenant / plan limits)      │
│  - Domain authentication check (SPF/DKIM/DMARC)       │
│  - Filter suppressed emails (bounce / complaint lists)  │
│  - Publish jobs to SQS queue                           │
└────────────────────────┬───────────────────────────────┘
                         │
                [Job Payload JSON]
                         │
                         ▼
               ┌──────────────────┐
               │    Amazon SQS    │
               │    email-jobs    │
               └────────┬─────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│             SERVICE 2 — Go Worker (SES)                │
│  - Long-polls SQS queue & parses payloads              │
│  - Dispatches email concurrently via AWS SES v2 API    │
│  - Updates job sending status in Supabase Postgres     │
│  - Requeues failed jobs / moves to DLQ after 3 retries  │
└────────────────────────────────────────────────────────┘
```

### Bounce & Complaint Lifecycle
```
AWS SES ──[Bounce/Complaint]──> AWS SNS ──> TS API (/internal/sns) ──> Suppress List & Webhook Trigger
```

---

## 📁 Repository Structure

```
EMAIL_AUTOMATION_SAAS/
├── api/                  # Vercel serverless entry points
├── apps/
│   └── dashboard/        # Next.js frontend application (Geist font + modern UI)
├── scripts/              # Helper scripts for testing domains, auth, and APIs
├── src/
│   ├── config/           # Database, AWS, and Environment configurations
│   ├── lib/              # SDK clients (AWS SES, SQS, Supabase)
│   ├── middleware/       # Rate limiting, auth validation, validation schemas
│   ├── routes/           # REST endpoints (sends, campaigns, unsubscribe, etc.)
│   └── app.ts            # Express application creation & routing setup
├── supabase/
│   └── migrations/       # SQL migrations for database setup
└── package.json          # Main workspace and API dependencies
```

---

## 🛠️ Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Supabase](https://supabase.com) project or PostgreSQL database
- [AWS Account](https://aws.amazon.com/) with SES production sandbox/access and SQS Queue configured

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/YeshwanthDandu180903/EMAIL_AUTOMATION_SAAS.git
cd EMAIL_AUTOMATION_SAAS
npm install
```

### 2. Environment Setup
Copy the example environment file and fill in your keys:
```bash
cp .env.example .env
```
Ensure you provide appropriate credentials for Supabase, AWS SES/SQS, and your local/staging setup.

### 3. Database Migration
Apply the migrations to your Supabase PostgreSQL instance:
```bash
# Apply SQL files located in ./supabase/migrations to your database in order.
# Or use Supabase CLI:
supabase db push
```

### 4. Running the API
Run the backend server in development mode:
```bash
npm run dev
```
The Express API will be running on `http://localhost:3000`.

### 5. Running the Dashboard
Navigate to the Next.js app directory and run the frontend:
```bash
cd apps/dashboard
npm install
npm run dev
```
The Dashboard will be running on `http://localhost:3001` (or next available port).

---

## 📡 API Reference

All requests must include an `x-api-key` header representing your tenant's API key.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **POST** | `/v1/send` | Sends a single or list of transactional emails. |
| **GET** | `/v1/sends/:jobId` | Retrieves status of a specific email send job. |
| **POST** | `/v1/campaigns` | Creates a new email campaign with snapshot contacts. |
| **POST** | `/v1/domains/verify` | Registers a domain with SES and generates DKIM tokens. |
| **GET** | `/v1/domains` | Lists all registered sender domains and verification status. |
| **POST** | `/v1/unsubscribe` | Unsubscribes a contact, changing their subscription state. |
| **POST** | `/internal/sns` | Internal webhook to process AWS SNS bounce/complaint alerts. |

### Sending an Email Example

**Request (`POST /v1/send`):**
```json
{
  "from": "hello@yourdomain.com",
  "to": ["recipient@example.com"],
  "subject": "Welcome to SwayamMail!",
  "html": "<h1>Welcome</h1><p>Thanks for joining us.</p>"
}
```

**Response (`202 Accepted`):**
```json
{
  "success": true,
  "message": "Email jobs queued successfully",
  "jobs": [
    {
      "jobId": "e3b0c442-98fc-11eb-a8b3-0242ac130003",
      "email": "recipient@example.com",
      "status": "queued"
    }
  ]
}
```

---

## 🗄️ Database Schema

SwayamMail uses the following schema in Supabase:

- **`tenants`**: Manages customer subscription plans, rate limits, API keys, and webhooks.
- **`domains`**: Handles custom domains (`domain`, `verified`, `dkim_record`).
- **`contacts`**: Stores customer email recipients, metadata, lists, and subscription states (`is_subscribed`).
- **`campaigns`**: Details campaign metadata, configurations, and scheduled times.
- **`campaign_contacts`**: Snapshot-based mapping of contacts added to campaigns (`campaign_id`, `email`, `source_type`).
- **`email_jobs`**: Logs individual sending jobs and statuses (`queued`, `delivered`, `failed`, `bounced`, `complained`).
- **`suppressed`**: Contains blacklisted emails (`email`, `reason: bounce | complaint`).

---

## 🗺️ Roadmap

### Phase 1 — MVP Core (Current)
- [x] Multi-tenant API key authorization and isolation.
- [x] AWS SES/SQS queue integration.
- [x] Auto-suppressions handling via SNS notifications.
- [x] Compliance unsubscribes (`List-Unsubscribe` headers).
- [x] Basic analytics and domain verification UI.

### Phase 2 — AI Assistant
- [ ] AI email writer (Claude/GPT API integration).
- [ ] AI template generation from plain text prompts.
- [ ] Drag-and-drop React-Email builder.
- [ ] Razorpay billing integration for INR subscriptions.

### Phase 3 — Workflow Automation
- [ ] Visual workflow builder with condition branching.
- [ ] Webhook triggers and automated campaign scheduling.
- [ ] Dedicated sending IPs and warmup automation.

---

## 📄 License & Team

- **Founder**: Sagun Varma (Yugaas)
- **License**: Distributed under the [ISC License](file:///c:/Users/Yeshwanth/Yugaas/github_clones/EMAIL_AUTOMATION_SAAS/LICENSE).