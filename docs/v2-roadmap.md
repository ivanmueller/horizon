# v2 roadmap

A grab-bag of follow-ups. Captured here so nothing gets lost between
sprints; not a commitment to ship any of it. Items are grouped by
theme and tagged with a rough priority based on what we've discussed,
plus an effort guess in commits.

Priority key:
- **P1** — likely to bite or directly unblocks scaling
- **P2** — meaningful improvement, not urgent
- **P3** — nice-to-have / quality-of-life

## Authentication & access control

| Priority | Item | Effort | Why |
|---|---|---|---|
| P1 | **Multi-hotel picker UI** on `/dashboard/hotel/` | 1 commit | Schema already supports it; v1 silently picks the first active `hotel_users` row. First chain partner who manages two hotels exposes this. |
| P1 | **Admin UI for `hotel_users`** (add / revoke from `/dashboard/horizon/`) | 2–3 commits | Replace the manual SQL insert with a form. Reduces the "ops via SQL Editor" load as you onboard. |
| P2 | **Magic-link auth for `/dashboard/horizon/`** (drop shared password) | 3–4 commits | Same flow as the partner dashboard. Drop the `HORIZON_ADMIN_PASSWORD` secret. Worth doing before you have more than 3 internal users. |
| P2 | **Role-based permissions** (`manager` vs `read-only` vs `admin`) | 1–2 commits | Schema's `role` column already exists. Add `where role = 'manager'` checks where mutations land. |
| P3 | **Self-service signup with approval queue** | 4–5 commits | A "Request access" form on the login page → row in a `pending_users` table → Horizon team approves from `/dashboard/horizon/`. Useful only if you're scaling onboarding past a handful per week. |
| P3 | **PKCE flow + cookie-based sessions** instead of localStorage tokens | 4–6 commits | More secure (HttpOnly cookies aren't readable from JS, so XSS can't exfiltrate). Worth doing if the dashboard ever shows genuinely sensitive data (PII, finances, etc.). For now the data on the partner dashboard is already what they have access to anyway. |

## Bokun integration

| Priority | Item | Effort | Why |
|---|---|---|---|
| P2 | **Bokun webhook** for status sync (cancellation, refund) | 4–5 commits | Already scoped in an earlier sprint. **Blocked**: requires a higher Bokun account tier than you currently have. Revisit when/if you upgrade. |
| P2 | **Daily Bokun poll** as a webhook alternative | 3–4 commits | Cloudflare Cron Trigger calls Bokun's bookings API once a day, diffs against Supabase, updates statuses. Only build this if Bokun won't expose webhooks. |
| P3 | **Drop the `scripts/bokun/sync-partners.mjs` workflow entirely** | 1 commit | We've already removed the runtime dependency on Bokun referrals. The script still works but isn't required for onboarding. Decide whether to retire it or keep it for record-keeping in Bokun. |

## Data & reporting

| Priority | Item | Effort | Why |
|---|---|---|---|
| P1 | **Refunds table** linked to `bookings` | 2–3 commits | Currently the schema has `pending_refund` / `refunded` statuses but no row-level history. A `refunds(id, booking_id, amount, reason, refunded_at, refunded_by)` table makes partial refunds + audit trail possible. |
| P1 | **Payouts table** + tracking what's been paid | 3–4 commits | Right now invoices are generate-on-demand, but there's no record of "we paid Hotel X $Y on date Z". A `payouts(id, hotel_id, period, amount, paid_at, method, reference)` table closes the loop. Lets the admin dashboard show "outstanding vs paid". |
| P2 | **Stripe webhook → automatic refund status sync** | 2–3 commits | When a refund settles in Stripe, flip `bookings.status` from `pending_refund` to `refunded` automatically. |
| P2 | **Audit log table** (`booking_status_changes`) | 2 commits | Captures every status mutation: who, when, what changed, optional reason. Currently a status change is destructive — only the latest state survives. |
| P3 | **Customer-level fields** (`lead_phone`, `stripe_customer_id`, `notes` on bookings) | 1 commit | Decided "no" in v1 to keep the schema lean. Add when there's a concrete use case. |

## Dashboard UX

| Priority | Item | Effort | Why |
|---|---|---|---|
| P1 | **Partner dashboard redesign** (`/dashboard/hotel/`) | 5–8 commits | You flagged you wanted to redo this anyway. Now lives on a real API with embedded `staff` blocks, ISO timestamps, and structured `hotel` info. Mobile-first this time. |
| P2 | **Hotel switcher** in the partner dashboard header | Bundled with multi-hotel picker (above) | |
| P2 | **Date filter timezone follow-through** for the rest of the app | 1 commit | The dashboards are fixed; the Node invoice generator's range math is still UTC-day-boundary. Edge case at end-of-month. Not critical. |
| P2 | **Email notifications** to hotels (booking confirmed, monthly statement ready) | 3–4 commits | Resend or Postmark integration. Nice partner experience; reduces "did this booking come through?" emails. |
| P3 | **Realtime updates** via Supabase Realtime | 2–3 commits | Push booking inserts to the dashboard instead of polling. Marginal value at current volume; relevant if a hotel ever wants the dashboard up live during peak hours. |
| P3 | **Dark mode** on the dashboards | 1 commit | Brand-permitting. |

## Operations & automation

| Priority | Item | Effort | Why |
|---|---|---|---|
| P1 | **Monthly invoice automation** | 2 commits | Currently `npm run invoices` runs on demand. Wrap it in a Cloudflare Cron Trigger or a GitHub Action that runs on the 1st of each month, generates all PDFs, emails them to hotel contacts. Add an emails section to `partners.json` (manager_email, accounting_email). |
| P2 | **Direct hotel onboarding flow** | 4–5 commits | Skip the Bokun referral creation entirely (already partly done — Horizon-side tracking is the source of truth). Build a signup form for hotels that creates the partners.json row, runs the seed, generates QR-ready URLs / printable link package. Cuts onboarding from "edit JSON + Bokun extranet + run seed" to "fill form, click submit". |
| P2 | **Batch invoice button** on `/dashboard/horizon/` | 1 commit | Generate all hotels' invoices for a period in one zip-style download or sequence of preview modals. The single-hotel button covers the manual case; this covers month-end. |
| P3 | **Booking notes / annotations** | 2 commits | Free-form text on a booking from the admin dashboard ("guest cancelled day-of, refund pending paperwork"). |

## Infrastructure & hardening

| Priority | Item | Effort | Why |
|---|---|---|---|
| P2 | **Self-host pdfkit + supabase-js bundles** | 1 commit | Drop the unpkg / esm.sh CDN dependencies. ~600KB in the repo for resilience against CDN outages or corp-network blocks. |
| P2 | **Supabase CLI for migrations** | Setup | We've been pasting SQL into the editor, which works but isn't scalable past ~5 migrations. `supabase db push` from the repo gives you proper drift detection and rollback. |
| P3 | **Worker tests / CI** | 2–3 commits | A few `vitest` / `node:test` cases against the auth helpers + JWT verification. GitHub Actions runs `node --check` + tests on every push. |
| P3 | **Sentry / error tracking** on the worker | 1 commit | Right now errors only show up if you tail `wrangler tail`. Sentry catches them and alerts you. |

## Growth & scale (further out)

| Priority | Item | Effort | Why |
|---|---|---|---|
| P3 | **Multi-tenant** support (separate Horizon verticals — adventure, urban, ski) | Big | Adds a `tenant_id` to most tables; segregates RLS. Real refactor. Only worth it if you actually launch a second brand. |
| P3 | **Multi-currency** | 2 commits | The schema has a `currency` column on bookings but we always use CAD. If you ever sell in USD or EUR. |
| P3 | **i18n** (French Canada at minimum) | Big | Tour pages + checkout + dashboards. Substantial. |

## Things explicitly NOT on the roadmap

Just so they don't accidentally get added:

- An ORM on the worker. Plain `fetch` to PostgREST is doing fine. Keep the worker lean.
- Server-side rendering / framework migration. The static-site + worker split works for the volume we're at and the deploy story is simple.
- A separate "manager mobile app." The dashboards work on mobile browsers; native apps add support burden.
- Anything that requires changing the partners.json source-of-truth model. It's a deliberate choice — git history is the audit trail, edit-and-seed is the workflow.
