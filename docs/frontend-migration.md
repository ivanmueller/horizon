# Frontend migration plan — HTML → React SPA

**Status:** Approved direction · **Last updated:** 2026-05-23

This is the canonical plan for moving the Horizon front end off the
in-browser-Babel prototypes and the monolithic HTML console onto a real,
buildable React stack — without touching the backend. It captures the
decision, the rules that constrain it, and the phase-by-phase path.

---

## TL;DR

- **Build the SaaS dashboards as a Vite + React + TypeScript SPA.** Not
  Next.js — the product is authenticated dashboards with no SEO/SSR need.
- **Freeze the backend.** The Bokun Worker API + Supabase + Stripe/Bokun
  stay exactly as they are. The only backend change is adding the new
  app's origin to `ALLOWED_ORIGINS`.
- **Two decoupled tracks.** Track A (kill in-browser Babel, ship the demo
  on a real build — *no backend work*) can happen now. Track B (wire live
  data) is deferrable and independent.
- **`admin/next/` is the future dashboard.** It morphs into the real admin
  console once Track B wires it to the API. The integration logic to port
  already exists and works in `admin/index.html` — treat that file as the
  reference spec.

---

## 1. Why this decision

### Current architecture (what we have)

| Layer | What it is | Disposition |
|---|---|---|
| **Backend API** | Cloudflare Worker `workers/bokun/index.js` — clean `/api/*` REST surface, Supabase-JWT auth, CORS allowlist, Stripe + Bokun + Short.io integrations | **Frozen.** System of record. |
| **Data/auth** | Supabase (Postgres + Auth) | **Frozen.** |
| **Hosting/routing** | Cloudflare Pages + `functions/_middleware.js` host split (`gowithhorizon.com` Tours / `connect.` portal / `admin.` console) | **Kept.** |
| **Admin console (prod)** | `admin/index.html` — ~489 KB monolith, real APIs (24 `/api/admin/*` endpoints), Supabase auth | **Reference spec** for Track B, then retired at cutover. |
| **Admin demo** | `admin/next/*.jsx` — React via `@babel/standalone` (in-browser transpile), mock data | **Becomes the new admin app.** |
| **Connect portal demo** | `dashboard/hotel/next/*.jsx` — same Babel-prototype pattern | Migrated **second**, reusing the admin app's foundation. |
| **Design system** | `css_new/` tokens (plain CSS custom properties) | **Reused as-is.** |
| **Tours (consumer)** | `tours/` — small static site | **Left alone.** Secondary cash-flow surface; not a focus. |

The backend is already fully decoupled from the front end and lives on its
own origin with CORS. Swapping the front end therefore does **not** require
touching the backend — the seam already exists.

### The pick: Vite + React + TypeScript SPA

The product is **authenticated B2B dashboards** (admin + Connect partner
portal), both behind login. The strategic priority is the SaaS dashboard;
the Tours consumer site is deprioritized cash flow.

- Every marquee Next.js feature (SSR, server components, ISR, SEO) earns its
  complexity on **public, content-driven** pages. A dashboard behind login
  renders an app shell then fetches per-user data — server rendering buys
  nothing here.
- The hireable skill is **React + TypeScript**, identical in both. A Next
  dev is productive in a Vite SPA on day one; the Next-specific knowledge is
  exactly the part we wouldn't use.
- Vite builds to **static assets** that deploy onto the **existing
  Cloudflare Pages** project — no new server runtime, no second backend, no
  hosting migration.
- No Next server means no temptation to fork business logic across two
  backends. The Worker stays the single source of truth.

**Stack:** Vite + React + TypeScript · **React Router v7** (routing) ·
**TanStack Query** (server-state) · the existing `css_new/` design tokens ·
a typed API client + Supabase auth.

**What would change this decision:** only if SaaS *marketing/lead-gen* SEO
became a near-term acquisition priority — and even then that's a separate,
small static surface, not a reason to wrap the dashboards in Next.

### What NOT to add

- **No Tailwind** — `css_new/` tokens are the design system; plain CSS custom properties work everywhere with zero runtime overhead.
- **No CSS-in-JS** — same reason; specificity fights and runtime cost for no gain when custom properties already do the job.
- **No Redux or Zustand** — TanStack Query owns server state; React's built-in hooks (`useState`, `useReducer`, `useContext`) own UI state. A global store adds a third source of truth with no clear owner.

---

## 2. Rules / invariants

These hold for the whole migration:

1. **The backend is frozen.** No rewrites of the Worker, Supabase schema, or
   Stripe/Bokun logic. The single allowed change is additive: add the new
   app origin to `ALLOWED_ORIGINS` in `workers/bokun/index.js`.
2. **Never fork business logic into a frontend server.** A SPA has no
   server; keep it that way. All API logic stays in the Worker.
3. **Every phase is independently shippable** and reversible.
   `admin/index.html` remains the working production console and instant
   rollback until cutover is proven.
4. **Tours stays static** until cash flow says otherwise. Don't rewrite it
   for consistency.
5. **Reuse, don't rebuild.** The `css_new/` tokens drop in unchanged; the
   demo components are ported, not rewritten; `admin/index.html` is the spec
   for every API interaction.
6. **TypeScript is required eventually, but must not gate "kill Babel."**
   Convert to a real build first (JS is fine), add types incrementally.
7. **Validate at the API boundary only.** Runtime response validation with **Zod** belongs at the API client seam — not spread through the app.

---

## 3. Target structure

```
apps/admin/                      # Vite + React + TS SPA (admin first)
  src/
    main.tsx                     # entry — replaces the Babel <script> tags
    routes/                      # React Router: /, /hotels, /hotels/:slug, /bookings, …
    pages/                       # OverviewPage, HotelsPage, HotelDetailPage, BookingsPage (ported)
    components/                  # Sidebar, Chrome/Topbar, PlacementLightbox, Icons (ported)
    lib/
      api/                       # typed API client + TanStack Query hooks (per resource)
      auth/                      # Supabase client + session/route guard
    styles/                      # imports css_new tokens (unchanged)
  .env                           # VITE_API_BASE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON
packages/                        # LATER — shared tokens, api client, ui (when Connect joins)
```

Start as a **single app**. Promote shared code into a `packages/` workspace
only when the Connect portal migrates — extracting later is cheap, a
monorepo on day one is not worth it.

---

## 4. Track A — Real build (do this now, no backend work)

Goal: the **identical demo, running on a production build** (minified,
code-split, no in-browser transpile). Verified scope: 12 components, ~1,806
lines, **zero third-party deps** beyond React/ReactDOM/Babel. A ~1–2 day
mechanical job.

### Phase 0 — Scaffold
- [ ] Create the Vite React app (start in **JS**, not TS — see Rule 6).
- [ ] Add React Router v7, TanStack Query, ESLint/Prettier, a CI build check.
- [ ] Add **Vitest** — it shares Vite's config and transform pipeline; zero extra setup. Wire it to CI now; write tests in Track B when API calls are real.

### Phase 1 — Port the design system as-is
- [ ] Import `css_new/` tokens + `admin/next/admin.css` (plain CSS, no
      changes). Move fonts from CDN/inline into the bundle.

### Phase 2 — Convert components from Babel-globals to ES modules
The mechanical core. For each `admin/next/*.jsx`:
- [ ] Replace the `window.X = X` export (13 of them) with `export`.
- [ ] Replace cross-component global refs (e.g. `HotelsPage` uses
      `StatusPill`, `HotelInitials`, `I`) with `import`.
- [ ] Replace `React.useState`/`React.useRef`/etc. (~26 calls) with named
      hook imports.
- [ ] Drop `@babel/standalone` and the `<script type="text/babel">` tags;
      `main.tsx`/`main.jsx` mounts `<App/>`.
- [ ] Keep the mock arrays (`HOTELS`, `ACTIVITY`, `BOOKINGS`) exactly where
      they are.

**Milestone:** the same demo, on a real build. The "won't survive
production" problem (in-browser Babel) is gone. Shippable as the demo.

### Phase 2.5 — Add TypeScript incrementally (after the milestone)
- [ ] Rename file-by-file to `.tsx`, tightening props as you go. Types land
      at the API boundary (Phase 3) first.
- [ ] Once the rename is complete, enable **`typescript-eslint`** with the `strict-type-checked` preset — catches real boundary-layer bugs that plain ESLint misses. Overkill before TS is in place.

---

## 5. Track B — Wire live data (deferrable, independent)

Track B = the demo's UI married to the integration logic that already works
in `admin/index.html`. The demo only models the **read/display** surface;
all auth + mutations + uploads live in the prod file. So this is
*translation of working code into a typed client*, not greenfield.

### Phase 3 — Cross-cutting infrastructure (build first)

Three patterns recur in every prod call and get centralized once:
- **Auth gate** (`admin/index.html:903–919`): `getSession()` → no session →
  redirect to Connect `/login/`; then `horizon_admins` (`status='active'`)
  check → non-admins → partner portal.
- **Token injection:** `Authorization: Bearer ${access_token}` on every
  call; `Content-Type: application/json` on writes.
- **Error normalization:** `const d = await res.json(); if (!res.ok) throw
  new Error(d?.error || 'fallback')` — identical everywhere.

Checklist:
- [ ] **`lib/auth/supabase.ts`** — `createClient(URL, ANON, { auth: {
      persistSession, autoRefreshToken, detectSessionInUrl, storage:
      cookieStorage }})`. **Critical:** reuse `/js/supabase-cookie-storage.js`
      — it shares the session across `connect.` and `admin.` subdomains.
      Default localStorage would break that SSO.
- [ ] **`lib/auth/gate.ts`** — port the session + `horizon_admins` check
      into a React route guard; reuse `connectUrl()` from `/js/hosts.js`.
- [ ] **`lib/api/client.ts`** — fetch wrapper: base URL from
      `VITE_API_BASE`, **lazy** token read per request (improves on the prod
      file, which captures `session` once at boot), JSON parse, the
      `res.ok`/`d.error` normalizer, 401 → login redirect.
- [ ] Wire the TanStack Query provider; mutations invalidate their
      resource's query key.
- [ ] Add **Zod** for API response validation — define schemas in `lib/api/schemas.ts` and validate every response at the client boundary. Surfaces field-name drift (see §8) as a hard error rather than a silent type hole.

### Phase 4 — Resource modules → hooks → demo component

Each module is a thin wrapper over endpoints proven in `admin/index.html`:

| Module | Endpoints | Feeds (demo component) |
|---|---|---|
| **hotels** | `GET /api/admin/hotels` · `GET /hotels/:id/events` · `POST /hotels` · `PATCH /hotels/:id` · `DELETE /hotels/:id` (soft-delete/status) | `HotelsPage`, `HotelDetailPage` |
| **summary** | `GET /api/admin/summary?from&to` | `OverviewPage` |
| **bookings** | `GET /api/dashboard/bookings?hotel=&from=` (per-hotel) · `GET /api/dashboard/bookings` (all) · `PATCH /api/admin/bookings/:id` | `BookingsPage` |
| **hotel-staff** | `GET …/hotel-staff/:id/stats?period=last30` · `POST` · `PATCH /:id` · `DELETE /:id` | `HotelSections` (Employees) |
| **hotel-users** | `POST /hotel-users` (invite) · `PATCH /:id` (role/status) | `HotelSections` (Managers) |
| **hotel-notes** | `GET ?hotel_id=` · `POST` · `DELETE /:id` | `HotelSidebar` (Notes) |
| **placements** | `POST` · `PATCH /:id` · `DELETE /:id` · `POST /:id/events` · `GET /:id/stats?period=last30` | `HotelSections`, `PlacementLightbox` |
| **placement-assets** | `POST /:id/assets/sign-upload` → `PUT signed_url` → `POST /:id/assets` → `PATCH /assets/:id` · `GET /assets/:id/url` (cached) | `PlacementLightbox` |
| **short-links** | `GET /hotels/:id/short-links` · `GET /short-links` · `POST` · `PATCH /:id` · `DELETE /:id` · `GET /:id/audit` · `POST /sync-clicks` | Short Links + hotel detail |
| **access-requests** | `GET /access-requests` · `PATCH /:id` (approve/deny) | `Sidebar` badge + Access requests |
| **payments** | `GET ?hotel_id=` · `POST` · `DELETE /:id` | `HotelSections` (Payments) |
| **payouts** | `GET ?hotel_id=` · `POST` · `DELETE /:id` | `HotelSections` (Payouts) |
| **system** | `POST /api/admin/republish` | Settings/action |

**Build order within Phase 4:**
1. **Read paths first** — `hotels.list` → `summary` → `bookings` → the
   hotel-detail GETs. Lights up the whole demo with real data before any
   mutation is written. Highest visible progress, lowest risk.
2. **Mutations per resource** — start with the simple ones (notes,
   access-requests) to prove the mutation + invalidation pattern, then the
   rest.
3. **Placement-asset upload last** — the only complex piece: a 3-step
   `sign → PUT-to-storage → record` sequence with progress callbacks
   (`onStep`). Model as one `useUploadPlacementAsset` mutation exposing
   `'Preparing' | 'Uploading' | 'Finalizing'`. Self-contained, so isolate it.
4. **System actions** — `republish`, `sync-clicks` (simple POST buttons).

### Phase 5 — Real routing
- [ ] Replace `App.jsx`'s `useState('hotels')` nav state-machine with React
      Router routes mirroring prod URLs: `/`, `/hotels`, `/hotels/:slug`
      (full-page hotel detail per the v1.2 chrome), `/bookings`,
      `/short-links`, `/access-requests`.
- [ ] Add the Supabase session route guard (Worker still does the
      authoritative `horizon_admins` check server-side).

---

## 6. Cutover (Cloudflare Pages — parallel & reversible)

`functions/_middleware.js` already serves an SPA shell for the admin host
from `/admin/index.html`.
- [ ] Build the Vite app into the Pages output.
- [ ] Run in parallel first — admin host serves the new shell only for
      opted-in routes; old and new coexist.
- [ ] Flip the middleware to hand back the new shell instead of
      `admin/index.html`.
- [ ] Keep `admin/index.html` in the repo as instant rollback until the new
      app has run clean for ~2 weeks.

No DNS, no host changes, no backend redeploy.

---

## 7. Then: the Connect partner portal

`dashboard/hotel/next/` is the same animal (`App.jsx`, `BookingsTable.jsx`,
`ChartPanel.jsx`, `ReferralLinks.jsx` — same Babel-prototype pattern).
Migrate it **second**, reusing the admin app's `lib/api`, `lib/auth`, design
tokens, and shared UI. At that point extract those into `packages/` and have
both apps consume them. Admin-first makes the Connect migration mostly
assembly.

---

## 8. Risks & watch-items

- **Field-name drift** between demo data and real API responses — contained
  because the demo was built to the API shape (`BookingsPage.jsx:3`), and
  Phase 3's types/zod surface every mismatch at the boundary.
- **Cross-subdomain SSO** — must reuse `cookieStorage`; localStorage breaks
  it. (Phase 3.)
- **Token freshness** — read the access token lazily per request so
  `autoRefreshToken` works on long sessions. (Phase 3.)
- **Overview N+1** (`admin/index.html:4104`) — the summary screen fires one
  `/api/dashboard/bookings` call per hotel. TanStack Query parallelizes it,
  so fine short-term; note as a candidate aggregate endpoint on the Worker
  later. **Do not change the backend now.**

---

## 9. Sequencing summary

| Priority | Work | Backend needed? |
|---|---|---|
| **Now** | Track A, Phases 0–2 (real build of the demo) | No |
| Soon | Phase 2.5 (incremental TS) | No |
| When data is a priority | Track B, Phases 3–5 (live data) | Only `ALLOWED_ORIGINS` |
| After admin proven | Connect portal migration + `packages/` extraction | No |

The framework choice is the low-stakes, reversible part. The decisions that
actually determine whether the SaaS scales — a typed API contract,
multi-tenancy/RBAC in the backend, auth robustness, testing/CI, design-system
discipline — are where the real attention goes.
