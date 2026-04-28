# Authentication

Two surfaces, one sign-in flow, two allowlists:

| Surface              | Who              | Allowlist table   |
|----------------------|------------------|-------------------|
| `/dashboard/hotel/`  | Hotel managers   | `hotel_users`     |
| `/admin/`            | Horizon team     | `horizon_admins`  |

Both surfaces sit behind the same `/dashboard/login/` page (magic
link, Google, or email + password). After sign-in, the page checks
`horizon_admins` first — if the user has an active row there, they
go to `/admin/`; otherwise they go to `/dashboard/hotel/`. Each
dashboard re-checks on its own boot too, so a direct visit to the
"wrong" page redirects cleanly.

Sign-in itself doesn't grant any access — the SQL row in the
appropriate allowlist table does. A user with neither a
`hotel_users` nor a `horizon_admins` row can authenticate just fine
but sees a "your account isn't linked yet" message on every
surface.

## Partner dashboard flow

There are three sign-in paths from `/dashboard/login/`:

| Path | First time | Returning |
|---|---|---|
| **Magic link** | Default for first visit. Email link → `/dashboard/setup/` (forced password set) → `/dashboard/hotel/`. | Used as a recovery path; same setup-then-hotel flow each time. |
| **Continue with Google** | Click button → Google consent → straight to `/dashboard/hotel/`. No password setup forced — Google IS the auth. | Same. |
| **Email + password** | Not available until they've set a password via `/dashboard/setup/` or the in-dashboard Account modal. | Default once `localStorage.horizon-last-signin-mode === 'password'` is set. |

End-to-end, magic-link path:

1. Manager opens `/dashboard/login/`, enters their email, clicks **Send magic link**.
2. Supabase emails them a one-shot URL like
   `https://gowithhorizon.com/dashboard/setup/#access_token=…&type=magiclink`.
3. They click it. `/dashboard/setup/` loads, `supabase-js` parses
   the URL hash and stores the session in `localStorage`. The hash
   is stripped from the URL bar.
4. Manager picks a password (twice for confirm) and clicks **Save
   password & continue**. The page calls
   `supabase.auth.updateUser({ password })`, flips
   `localStorage.horizon-last-signin-mode` to `'password'` so future
   visits to `/login/` open in password mode by default, and
   redirects to `/dashboard/hotel/`.
5. `/dashboard/hotel/` loads, finds the active session,
   `supabase.from('hotel_users').select(...)` to resolve which hotel
   the manager is assigned to (RLS scopes to their own row), then
   fetches bookings via the worker.
6. Booking fetch carries `Authorization: Bearer <access_token>`.
7. The worker:
   - Verifies the JWT signature against Supabase's JWKS endpoint
     (`$SUPABASE_URL/auth/v1/.well-known/jwks.json`). Supabase
     migrated to asymmetric signing keys (ES256/RS256) in 2025; the
     verification keys are public, so no shared secret is needed —
     just the project URL. JWKS is cached at module scope for an
     hour with auto-refresh on unknown `kid`.
   - Checks `aud === 'authenticated'`.
   - Looks up `hotel_users` for `(email, hotel_id, status='active')`.
   - 401 if the JWT is bad, 403 if the assignment doesn't exist.
8. On success, the worker queries Supabase via the service-role key
   (bypassing RLS) and returns the bookings.

The "Forgot password?" path follows the same shape: email link goes
to `/dashboard/setup/`, manager picks a new password, lands on
`/dashboard/hotel/`. So password reset and first-time setup share
one page.

Google sign-in skips `/dashboard/setup/` entirely — `signInWithOAuth`
configures the redirect to `/dashboard/hotel/` directly. A manager
who only ever uses Google never sets a password and never has to.

The defense-in-depth picture:

- **RLS on the database** stops the anon key from seeing anything
  it shouldn't. Direct `supabase-js` calls from the page (e.g. the
  hotel_users lookup at step 5) are scoped by the user's JWT.
- **JWT verification on the worker** prevents a forged token from
  driving the service-role query path. Even if RLS were
  misconfigured, a bad JWT can't reach the service-role key.
- **`hotel_users` check on the worker** scopes per-request access:
  a valid JWT for `manager@hotel-a.com` can't read hotel B's
  bookings even if they pass `?hotel=hotel-b`.

## Granting a hotel manager access

There's no signup form yet; access is granted manually. From the
Supabase **SQL Editor**:

```sql
-- Grant Jane access to Fairmont Chateau Lake Louise
insert into hotel_users (email, hotel_id, role)
values (
  'jane@fairmont.com',
  (select id from hotels where code = 'fairmont-ll'),
  'manager'
);
```

Notes:
- `email` is stored as-typed, but lookups use `lower(email)` and
  `ilike` (case-insensitive). Consistency only matters for human
  readability of the table.
- `role` is `'manager'` for v1. The schema also accepts `'admin'`
  for sub-roles within a hotel later (e.g. read-only viewer for an
  external auditor). Cross-hotel Horizon-team admins live in the
  separate `horizon_admins` table, not here.
- A manager who handles multiple hotels gets multiple rows.
- To revoke access, **don't delete the row** — set `status = 'revoked'`
  so the audit trail survives:
  ```sql
  update hotel_users
     set status = 'revoked'
   where email = 'jane@fairmont.com'
     and hotel_id = (select id from hotels where code = 'fairmont-ll');
  ```

## Granting a Horizon admin

Same SQL pattern, different table — `horizon_admins` is keyed on
email only (no `hotel_id`; admins are cross-hotel by definition).

```sql
-- Grant admin access to a Horizon team member
insert into horizon_admins (email, role)
values ('teammate@gowithhorizon.com', 'admin');
```

To revoke without deleting:

```sql
update horizon_admins
   set status = 'revoked'
 where lower(email) = lower('teammate@gowithhorizon.com');
```

A user with rows in **both** tables (e.g. a Horizon staffer who
also manages their own hotel for testing) gets routed to `/admin/`
by default — admin status takes precedence on the routing decision.
They can still view a partner dashboard by manually visiting
`/dashboard/hotel/`, but it would route them right back to
`/admin/`. To test the partner view, sign out and use a different
account, or temporarily revoke their `horizon_admins` row.

## Supabase project setup (one-time)

In the Supabase dashboard, **Authentication → Providers**:

- **Email**: enabled. Disable "Confirm email" for the magic-link
  flow (the link itself is the confirmation).
- All other providers can stay disabled until/unless you want SSO
  (Google for hotel chains, etc.).

**Authentication → URL Configuration**:

- **Site URL**: `https://gowithhorizon.com`
- **Redirect URLs** (allowlist): `https://gowithhorizon.com/dashboard/hotel/`,
  `http://localhost:*/dashboard/hotel/` (for local dev), and any
  Cloudflare Pages preview URL pattern you use.

**Authentication → Email Templates**:

The default magic-link template works. If you want to brand it,
"Magic Link" is the template that fires on `signInWithOtp`. Keep
the `{{ .ConfirmationURL }}` variable intact.

## Testing locally

1. Pull the branch + apply migrations 0003 in the SQL Editor.
2. Insert a hotel_users row for your own email.
3. Open `/dashboard/login/` (deployed or local), enter your email.
4. Check inbox, click the link.
5. You should land on `/dashboard/hotel/?hotel=<your-hotel>` with
   data for that hotel only.
6. Try `?hotel=<other-hotel>` — worker should return 403, the page
   shows the error.

## Worker secrets + vars

| Secret / Var              | Purpose                                                   |
|---------------------------|-----------------------------------------------------------|
| `SUPABASE_URL` (var)      | Project URL — also where the JWKS endpoint lives          |
| `SUPABASE_SERVICE_KEY`    | service-role key for the worker's data fetches; bypasses RLS |

Notably absent: a JWT verification secret AND a shared admin
password. Both auth gates verify Supabase user JWTs against the
project's public JWKS endpoint, so no shared secret is needed.
The retired `HORIZON_ADMIN_PASSWORD` can be deleted from the worker
once the migration is verified end-to-end:

```bash
wrangler secret delete HORIZON_ADMIN_PASSWORD
```

## What's not yet built

- **Multi-hotel managers**: schema supports it (multiple
  hotel_users rows per email), but the dashboard picks the first
  active assignment and runs with it. A picker drops in when
  there's a real chain to onboard.
- **Self-service hotel signup**: not in scope. Onboarding is via
  partners.json + the SQL insert above.
- **Magic-link for the admin dashboard**: deferred. Shared password
  is fine while the admin user count is one to three.
- **Session timeout / forced re-auth**: Supabase's defaults
  (1-hour access token, 30-day refresh) apply. Override in the
  Supabase dashboard if you want shorter.
