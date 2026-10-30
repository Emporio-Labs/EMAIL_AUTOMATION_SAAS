# Shared core

The `core` Postgres schema holds what every product in the suite shares: Swayam Mail now, Whatomation and the AI worker next. It is created by `supabase/migrations/0030_core.sql`. The migration only adds things; it changes no existing table.

Architecture doc: https://claude.ai/artifact/6MeyRct64x8QbYKnMqzRgM

## What lives here

| Table | Purpose |
|---|---|
| `core.org_products` | Which products an org has on (`mail`, `whatsapp`, `ai`), with plan and status |
| `core.business_profiles` | Business name, description, tone, languages, hours. Read by email footers, the WhatsApp bot and AI skills |
| `core.contacts` | One person with an email and/or an E.164 phone, consent per channel (`email_status`, `whatsapp_opt_in`), tags, attributes |
| `core.events` | Outbox for the shared event envelope (`product.object.action`). A relay delivers rows and sets `published_at` |
| `core.event_type_aliases` | Maps Swayam Mail's current webhook names (`email.opened`) to shared names (`email.message.read`) |
| `core.usage_records` | One row per billable unit, unique on `(org_id, meter, source_id)` so retries never double-bill |

Orgs and members are still `public.tenants` and `public.tenant_members`; `org_id` in core references `public.tenants(id)`.

## Functions

- `core.emit_event(org_id, product, type, data)` writes one event and returns its `evt_...` id.
- `core.record_usage(org_id, product, meter, quantity, source_id, occurred_at)` records usage once; repeats are ignored.
- `core.sync_from_mail()` copies tenants (as `mail` products and business profiles) and contacts into core. Backfilled contacts keep their `public.contacts` id. Safe to rerun.

## Access

Only the service role can use the schema. RLS is on with no policies, and the schema is not exposed through the Supabase REST API, so the dashboard cannot read it directly. Products reach it from their servers.

## Not done yet

- Mail still reads and writes `public.contacts`; nothing calls `emit_event` or `record_usage` yet. Wiring those in comes after the mail launch work.
- API key scopes, and moving Whatomation onto Supabase Auth and `org_id`.
