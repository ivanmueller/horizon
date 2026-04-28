# Authentication

Two surfaces with two auth models:

| Surface                              | Who                  | Auth                                          |
|--------------------------------------|----------------------|-----------------------------------------------|
| `/dashboard/hotel/?hotel=<slug>`     | Hotel managers       | Supabase magic-link → JWT → RLS-scoped reads  |
| `/dashboard/horizon/`                | Horizon team         | Shared password (`HORIZON_ADMIN_PASSWORD`)    |

The split is intentional for now — internal admin is one to three
people, magic-link wouldn't add much. Partner access is N hotels
growing toward 30+, so it has to be properly identified per user.
A future sprint can migrate the admin surface onto magic-link too;
the schema and worker helpers already support it.

## Partner dashboard flow

The mechanics, end to end:

1. Manager opens `/dashboard/login/`, enters their email, clicks **Send magic link**.
2. Supabase emails them a one-shot URL like
   `https://gowithhorizon.com/dashboard/hotel/#access_token=…&refresh_token=…&type=magiclink`.
3. They click it. The dashboard page loads, `supabase-js` parses the
   tokens out of the URL hash and stores the session in
   `localStorage`. The page then re-replaces the URL bar to drop the
   hash so the access token doesn't sit in browser history.
4. The page calls `supabase.auth.getSession()` — present, so it
   proceeds. The session also carries an `access_token` (a JWT).
5. If the URL has no `?hotel=…` slug, the page queries `hotel_users`
   via the SDK (RLS scopes the result to the user's own rows) and
   redirects to `/dashboard/hotel/?hotel=<their-slug>`.
6. The page fetches `/api/dashboard/bookings?hotel=<slug>&…` with
   `Authorization: Bearer <access_token>`.
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
  for future Horizon-wide access via this table instead of a
  shared password.
- A manager who handles multiple hotels gets multiple rows.
- To revoke access, **don't delete the row** — set `status = 'revoked'`
  so the audit trail survives:
  ```sql
  update hotel_users
     set status = 'revoked'
   where email = 'jane@fairmont.com'
     and hotel_id = (select id from hotels where code = 'fairmont-ll');
  ```

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
| `HORIZON_ADMIN_PASSWORD`  | Shared password for the internal `/dashboard/horizon/`    |

Notably absent: a JWT verification secret. Supabase's asymmetric
signing keys are exposed publicly via the JWKS endpoint, so the
worker can verify tokens with just the project URL it already has.

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
