import {
  supabaseRequest,
  supabaseSelect,
  supabaseInsert,
  supabaseUpdate,
  jsonResponse,
  readJson,
  requireAuthenticated,
  parseTimeBound,
  CURRENCY,
  EMAIL_RE,
} from "./shared.js";

// ── Hotel-manager dashboard ledger ─────────────────────────────────────────
// Inserts a row into Supabase `bookings` after a confirmed Bokun booking.
// Resolves hotel_id from the slug and (if a tracking code matches) staff_id
// from hotel_staff in parallel, then INSERT … ON CONFLICT DO NOTHING on
// confirmation_code so the page's fire-and-forget retries are idempotent.
export async function handleDashboardRecord(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const hotel = typeof body.hotel === "string" ? body.hotel.trim().toLowerCase() : "";
  const code = typeof body.confirmation_code === "string" ? body.confirmation_code.trim() : "";
  const bookingId = typeof body.booking_id === "string" ? body.booking_id.trim() : "";
  const trackingCode =
    typeof body.tracking_code === "string" ? body.tracking_code.trim() : "";
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  if (!code) {
    return jsonResponse({ error: "confirmation_code required" }, 400, request);
  }

  // Parallel lookups — saves a round trip vs. sequential. Staff
  // resolution matches on the partner-controlled slug
  // (hotel_staff.tracking_code, e.g. FAIRMONT_LL_JS) rather than the
  // hex tracking codes Bokun used to mint.
  const [hotelRows, staffRows] = await Promise.all([
    supabaseSelect(env, `hotels?code=eq.${encodeURIComponent(hotel)}&select=id`),
    trackingCode
      ? supabaseSelect(
          env,
          `hotel_staff?tracking_code=eq.${encodeURIComponent(trackingCode)}&select=id,hotel_id`,
        )
      : Promise.resolve([]),
  ]);

  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 400, request);
  }
  const hotelId = hotelRows[0].id;

  // Only attribute to staff if their hotel matches — defends against a
  // tracking-code collision between hotels. Hotel-level codes (e.g.
  // FAIRMONT_LL) won't match any hotel_staff row and so resolve to
  // staff_id=null, which is the correct "hotel pool" attribution.
  const staffMatch = staffRows[0];
  const staffId = staffMatch && staffMatch.hotel_id === hotelId ? staffMatch.id : null;

  const row = {
    booking_id:        bookingId || null,
    hotel_id:          hotelId,
    staff_id:          staffId,
    confirmation_code: code,
    tour_id:           body.tour_id ?? null,
    tour_title:        typeof body.tour_title === "string" ? body.tour_title : null,
    date:              typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
                       ? body.date
                       : null,
    time:              typeof body.time === "string" ? body.time : null,
    adults:            Number.parseInt(body.adults, 10) || 0,
    youth:             Number.parseInt(body.youth, 10) || 0,
    infants:           Number.parseInt(body.infants, 10) || 0,
    amount:            typeof body.amount === "number" ? body.amount : null,
    currency:          typeof body.currency === "string" ? body.currency : CURRENCY,
    lead_name:         typeof body.lead_name === "string" ? body.lead_name : null,
    lead_email:        typeof body.lead_email === "string" ? body.lead_email : null,
  };

  // ignore-duplicates → INSERT … ON CONFLICT (confirmation_code) DO NOTHING.
  // Keeps the first record if the page retries with the same code.
  await supabaseRequest(env, "POST", "/bookings?on_conflict=confirmation_code", {
    body: [row],
    prefer: "resolution=ignore-duplicates,return=minimal",
  });

  return jsonResponse({ ok: true }, 200, request);
}

export async function handleDashboardBookings(url, env, request) {
  // Auth gate: caller must present a Supabase JWT and be assigned to
  // the requested hotel via hotel_users. Service-role bypasses RLS on
  // the actual data fetch, so the authorization decision lives here
  // rather than relying on PostgREST policies.
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;
  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) {
    return jsonResponse({ error: "jwt missing email claim" }, 401, request);
  }

  const hotel = (url.searchParams.get("hotel") || "").trim().toLowerCase();
  if (!hotel || !/^[a-z0-9-]{2,40}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }
  const from = url.searchParams.get("from"); // YYYY-MM-DD or ISO datetime, optional
  const to = url.searchParams.get("to");
  const fromTs = parseTimeBound(from, "start");
  const toTs = parseTimeBound(to, "end");
  const fromOk = !!fromTs;
  const toOk = !!toTs;

  // 1) Resolve the hotel — also gives us the partner block for the
  //    response so the dashboard doesn't need a separate lookup.
  const hotelRows = await supabaseSelect(
    env,
    `hotels?code=eq.${encodeURIComponent(hotel)}` +
      `&select=id,code,name,location,type,commission_pct,kickback_pool_pct`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel slug: ${hotel}` }, 404, request);
  }
  const h = hotelRows[0];

  // 2) Authorize. Two paths:
  //    a) horizon_admins → can read any hotel's bookings (the /admin/
  //       dashboard expands every hotel row + generates invoices for
  //       all of them).
  //    b) hotel_users    → restricted to their assigned hotel(s) —
  //       this is the partner-side dashboard at /dashboard/hotel/.
  //    ilike with no wildcards = case-insensitive equals, lines up
  //    with how lower(email) is indexed on both tables.
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}` +
      `&status=eq.active&select=id`,
  );
  const isHorizonAdmin = adminRows.length > 0;
  if (!isHorizonAdmin) {
    const assignmentRows = await supabaseSelect(
      env,
      `hotel_users?email=ilike.${encodeURIComponent(userEmail)}` +
        `&hotel_id=eq.${h.id}&status=eq.active&select=id`,
    );
    if (!assignmentRows.length) {
      return jsonResponse({ error: "forbidden" }, 403, request);
    }
  }

  // 3) Pull the bookings, embedding the linked staff row when present.
  //    Limit 1000 covers months per hotel; paginate via cursor when a
  //    partner outgrows it.
  const fields =
    "id,booking_id,confirmation_code,tour_id,tour_title,date,time," +
    "adults,youth,infants,amount,currency,lead_name,lead_email," +
    "status,created_at,updated_at," +
    "staff:hotel_staff(id,code,name,tracking_code,kickback_pct)";
  let q =
    `bookings?hotel_id=eq.${h.id}` +
    `&select=${fields}` +
    `&order=created_at.desc&limit=1000`;
  if (fromOk) q += `&created_at=gte.${encodeURIComponent(fromTs)}`;
  if (toOk) q += `&created_at=lte.${encodeURIComponent(toTs)}`;

  const rows = await supabaseSelect(env, q);

  // PostgREST returns `numeric` columns as JSON strings to preserve
  // precision; coerce to Number for clean arithmetic on the page.
  const records = rows.map((r) => ({
    ...r,
    amount: r.amount != null ? Number(r.amount) : null,
  }));

  // KPIs only count confirmed — cancelled and refunded bookings show in
  // the records list (so the partner sees what was reversed) but are
  // never owed.
  const kpis = records.reduce(
    (acc, r) => {
      if (r.status !== "confirmed") return acc;
      acc.bookings += 1;
      acc.travelers += (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
      acc.revenue += r.amount != null ? r.amount : 0;
      return acc;
    },
    { bookings: 0, travelers: 0, revenue: 0 },
  );

  return jsonResponse(
    {
      hotel: {
        code:              h.code,
        name:              h.name,
        location:          h.location,
        type:              h.type,
        commission_pct:    h.commission_pct != null ? Number(h.commission_pct) : 0,
        kickback_pool_pct: h.kickback_pool_pct != null ? Number(h.kickback_pool_pct) : null,
      },
      from: fromOk ? from : null,
      to: toOk ? to : null,
      kpis,
      records,
    },
    200,
    request,
  );
}

// GET /api/dashboard/hotel-links?hotel=<slug>
// Returns active short_links for a hotel so the partner dashboard can
// display referral links + click counts. Auth: same hotel-manager
// guard as /api/dashboard/bookings (horizon admin OR hotel_users member).
export async function handleDashboardHotelLinks(url, env, request) {
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;
  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) {
    return jsonResponse({ error: "jwt missing email claim" }, 401, request);
  }

  const hotel = (url.searchParams.get("hotel") || "").trim().toLowerCase();
  if (!hotel || !/^[a-z0-9-]{2,60}$/.test(hotel)) {
    return jsonResponse({ error: "hotel slug required" }, 400, request);
  }

  const hotelRows = await supabaseSelect(
    env,
    `hotels?code=eq.${encodeURIComponent(hotel)}&select=id,code,name`,
  );
  if (!hotelRows.length) {
    return jsonResponse({ error: `unknown hotel: ${hotel}` }, 404, request);
  }
  const h = hotelRows[0];

  // Auth: admin or assigned hotel_user
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}&status=eq.active&select=id`,
  );
  if (!adminRows.length) {
    const assignRows = await supabaseSelect(
      env,
      `hotel_users?email=ilike.${encodeURIComponent(userEmail)}&hotel_id=eq.${h.id}&status=eq.active&select=id`,
    );
    if (!assignRows.length) {
      return jsonResponse({ error: "forbidden" }, 403, request);
    }
  }

  const fields =
    "id,short_url,short_path,target_url,label,link_type," +
    "staff_id,click_count_cached,last_clicked_at," +
    "staff_member:hotel_staff(name)";
  const links = await supabaseSelect(
    env,
    `short_links?hotel_id=eq.${h.id}&status=eq.active&select=${fields}&order=created_at.asc`,
  );
  return jsonResponse({ short_links: links }, 200, request);
}

// ── Auth helpers ──────────────────────────────────────────────────────
//
// POST /api/auth/preflight  { email }
//   No auth required. Checks hotel_users and horizon_admins in parallel
//   and returns one of three states the login page branches on:
//     password_required  — active row exists and password_set_at is set
//     first_time_setup   — active row exists but password never set
//     not_approved       — no active row for this email
//   Both DB queries always run regardless of result so response timing
//   is consistent across all three outcomes (mitigates email enumeration).
//
// PATCH /api/auth/mark-password-set
//   Requires a valid Supabase JWT. Called by /dashboard/setup/ and the
//   Account modal after a successful supabase.auth.updateUser({ password }).
//   Stamps password_set_at = now() on whichever table the caller's email
//   belongs to — hotel_users or horizon_admins. Both updates run in
//   parallel; the one with no matching row is a silent no-op.

export async function handleAuthPreflight(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);

  const enc = encodeURIComponent(email);
  const [adminRows, managerRows] = await Promise.all([
    supabaseSelect(env, `horizon_admins?email=ilike.${enc}&status=eq.active&select=id,password_set_at`),
    supabaseSelect(env, `hotel_users?email=ilike.${enc}&status=eq.active&select=id,password_set_at`),
  ]);

  const row = adminRows[0] ?? managerRows[0];
  if (!row) return jsonResponse({ status: "not_approved" }, 200, request);

  return jsonResponse(
    { status: row.password_set_at ? "password_required" : "first_time_setup" },
    200,
    request,
  );
}

export async function handleAuthMarkPasswordSet(request, env) {
  const auth = await requireAuthenticated(request, env);
  if (auth.error) return auth.error;

  const userEmail = String(auth.claims.email || "").trim();
  if (!userEmail) return jsonResponse({ error: "jwt missing email claim" }, 401, request);

  const enc = encodeURIComponent(userEmail);
  const now = new Date().toISOString();

  await Promise.all([
    supabaseUpdate(env, `hotel_users?email=ilike.${enc}&status=eq.active`, { password_set_at: now }),
    supabaseUpdate(env, `horizon_admins?email=ilike.${enc}&status=eq.active`, { password_set_at: now }),
  ]);

  return jsonResponse({ ok: true }, 200, request);
}

// POST /api/auth/access-request — no auth required.
// Records a request-access submission from the login page's not-approved
// state. Inserts a pending row into access_requests so the admin inbox
// can surface it for review. Duplicate submissions are fine — the admin
// sees all of them.
export async function handleAuthAccessRequest(request, env) {
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const name  = typeof body.name  === "string" ? body.name.trim()  : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);
  if (!name) return jsonResponse({ error: "name required" }, 400, request);

  const row = {
    email,
    name,
    property_requested: typeof body.property_requested === "string"
      ? body.property_requested.trim() || null : null,
    reason: typeof body.reason === "string"
      ? body.reason.trim() || null : null,
  };

  await supabaseInsert(env, "access_requests", [row]);
  return jsonResponse({ ok: true }, 201, request);
}
