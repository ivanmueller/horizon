import {
  supabaseSelect,
  supabaseInsert,
  supabaseUpdate,
  jsonResponse,
  readJson,
  requireHorizonAdmin,
  logMutation,
  parseTimeBound,
  round2,
  UUID_RE,
  EMAIL_RE,
  ALLOWED_STATUSES,
  HOTEL_FIELDS,
  STAFF_FIELDS,
  MANAGER_FIELDS,
  SHORT_LINK_FIELDS,
  SHORT_LINK_TYPES,
  SHORT_LINK_STATUSES,
  SHORT_PATH_RE,
  MANAGER_STATUSES,
  mintShortLinkAndRecord,
  insertHotelWithPrefix,
  insertStaffWithSequence,
  validateHotel,
  validateStaff,
  normaliseHotel,
  normaliseStaff,
  normaliseShortLink,
  isUniqueViolation,
  hotelTargetUrl,
  staffTargetUrl,
  syncClickCounts,
} from "./shared.js";
import {
  updateShortLink,
  ShortIoError,
  trackingCodeToShortPath,
} from "./short-io.js";

// ── Horizon admin (internal) ───────────────────────────────────────────────
// Cross-hotel summary for the internal commission dashboard. Gated by a
// Supabase Auth JWT plus an active row in the horizon_admins table —
// signing in by itself isn't enough; the email has to be on the
// allowlist. Excludes cancelled and refunded bookings from all totals.
export async function handleAdminSummary(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromTs = parseTimeBound(from, "start");
  const toTs = parseTimeBound(to, "end");
  if (!fromTs || !toTs) {
    return jsonResponse(
      { error: "from and to (YYYY-MM-DD or ISO 8601) required" },
      400,
      request,
    );
  }

  const fields =
    "id,confirmation_code,date,time,adults,youth,infants,amount,currency," +
    "tour_title,tour_id,lead_name,created_at,status," +
    "hotel:hotels(id,code,name,location,type,commission_pct,kickback_pool_pct)," +
    "staff:hotel_staff(id,code,name,tracking_code,kickback_pct)";
  const q =
    `bookings?status=eq.confirmed` +
    `&created_at=gte.${encodeURIComponent(fromTs)}` +
    `&created_at=lte.${encodeURIComponent(toTs)}` +
    `&select=${fields}` +
    `&order=created_at.desc&limit=10000`;
  const rows = await supabaseSelect(env, q);

  const hotelMap = new Map();
  const totals = { bookings: 0, travelers: 0, revenue: 0, commission_owed: 0 };

  for (const r of rows) {
    if (!r.hotel) continue; // hotel_id is NOT NULL but defend defensively
    const amount = r.amount != null ? Number(r.amount) : 0;
    const travelers = (r.adults || 0) + (r.youth || 0) + (r.infants || 0);
    const commissionPct =
      r.hotel.commission_pct != null ? Number(r.hotel.commission_pct) : 0;
    const commission = (amount * commissionPct) / 100;

    let h = hotelMap.get(r.hotel.code);
    if (!h) {
      h = {
        code:            r.hotel.code,
        name:            r.hotel.name,
        location:        r.hotel.location,
        type:            r.hotel.type,
        commission_pct:  commissionPct,
        bookings:        0,
        travelers:       0,
        revenue:         0,
        commission_owed: 0,
        kickbacks_total: 0,
        _staffMap:       new Map(),
      };
      hotelMap.set(r.hotel.code, h);
    }

    h.bookings += 1;
    h.travelers += travelers;
    h.revenue += amount;
    h.commission_owed += commission;

    if (r.staff) {
      const kPct = r.staff.kickback_pct != null ? Number(r.staff.kickback_pct) : 0;
      const kAmt = (amount * kPct) / 100;
      let s = h._staffMap.get(r.staff.code);
      if (!s) {
        s = {
          staff_code:    r.staff.code,
          staff_name:    r.staff.name,
          kickback_pct:  kPct,
          bookings:      0,
          revenue:       0,
          kickback_owed: 0,
        };
        h._staffMap.set(r.staff.code, s);
      }
      s.bookings += 1;
      s.revenue += amount;
      s.kickback_owed += kAmt;
      h.kickbacks_total += kAmt;
    }

    totals.bookings += 1;
    totals.travelers += travelers;
    totals.revenue += amount;
    totals.commission_owed += commission;
  }

  const hotels = Array.from(hotelMap.values()).map((h) => ({
    code:            h.code,
    name:            h.name,
    location:        h.location,
    type:            h.type,
    commission_pct:  h.commission_pct,
    bookings:        h.bookings,
    travelers:       h.travelers,
    revenue:         round2(h.revenue),
    commission_owed: round2(h.commission_owed),
    kickbacks: Array.from(h._staffMap.values()).map((s) => ({
      staff_code:    s.staff_code,
      staff_name:    s.staff_name,
      kickback_pct:  s.kickback_pct,
      bookings:      s.bookings,
      revenue:       round2(s.revenue),
      kickback_owed: round2(s.kickback_owed),
    })),
    kickbacks_total: round2(h.kickbacks_total),
  }));

  hotels.sort((a, b) => b.revenue - a.revenue);

  const kickbacksOwed = hotels.reduce((acc, h) => acc + h.kickbacks_total, 0);

  return jsonResponse(
    {
      from,
      to,
      totals: {
        bookings:        totals.bookings,
        travelers:       totals.travelers,
        revenue:         round2(totals.revenue),
        commission_owed: round2(totals.commission_owed),
        kickbacks_owed:  round2(kickbacksOwed),
        net_to_horizon:  round2(totals.revenue - totals.commission_owed - kickbacksOwed),
      },
      hotels,
    },
    200,
    request,
  );
}

export async function handleAdminBookingPatch(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid booking id" }, 400, request);
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!ALLOWED_STATUSES.has(status)) {
    return jsonResponse(
      {
        error: "status must be one of: " + Array.from(ALLOWED_STATUSES).join(", "),
      },
      400,
      request,
    );
  }

  // return=representation so we can confirm the row actually existed —
  // PostgREST returns [] for a no-match update, which we surface as 404.
  const updated = await supabaseUpdate(
    env,
    `bookings?id=eq.${encodeURIComponent(id)}`,
    { status },
    { returnRow: true },
  );

  if (!Array.isArray(updated) || updated.length === 0) {
    return jsonResponse({ error: "booking not found" }, 404, request);
  }

  logMutation(request, auth.claims, "update", "booking", id, { status });
  return jsonResponse({ ok: true, booking: updated[0] }, 200, request);
}

export async function handleAdminHotelsList(env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const select =
    HOTEL_FIELDS +
    `,staff:hotel_staff(${STAFF_FIELDS})` +
    `,managers:hotel_users(${MANAGER_FIELDS})` +
    `,short_links:short_links(${SHORT_LINK_FIELDS})`;
  const rows = await supabaseSelect(env, `hotels?select=${select}&order=code.asc`);
  return jsonResponse({ hotels: rows.map(normaliseHotel) }, 200, request);
}

export async function handleAdminHotelCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateHotel(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const { hotel, shortLinkWarning } = await insertHotelWithPrefix(env, v.row);
    logMutation(request, auth.claims, "create", "hotel", hotel.id, {
      code: hotel.code, name: hotel.name,
    });
    const payload = { hotel: normaliseHotel(hotel) };
    if (shortLinkWarning) payload.short_link_warning = shortLinkWarning;
    return jsonResponse(payload, 201, request);
  } catch (err) {
    if (isUniqueViolation(err, "code") || isUniqueViolation(err, "hotels_code_key")) {
      return jsonResponse({ error: `hotel with code "${v.row.code}" already exists` }, 409, request);
    }
    throw err;
  }
}

export async function handleAdminHotelUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateHotel(body, { creating: false });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);
  // Don't allow code changes — slug is the URL identity, would break QR codes.
  delete v.row.code;

  const updated = await supabaseUpdate(
    env, `hotels?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "hotel", id, { fields: Object.keys(v.row) });
  return jsonResponse({ hotel: normaliseHotel(updated[0]) }, 200, request);
}

export async function handleAdminHotelTerminate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel id" }, 400, request);

  const updated = await supabaseUpdate(
    env, `hotels?id=eq.${encodeURIComponent(id)}`,
    { status: "terminated" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel not found" }, 404, request);
  }
  logMutation(request, auth.claims, "terminate", "hotel", id);
  return jsonResponse({ hotel: normaliseHotel(updated[0]) }, 200, request);
}

export async function handleAdminStaffCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateStaff(body, { creating: true });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);

  try {
    const { staff, shortLinkWarning } = await insertStaffWithSequence(env, v.row);
    logMutation(request, auth.claims, "create", "staff", staff.id, {
      hotel_id: v.row.hotel_id, tracking_code: staff.tracking_code, name: staff.name,
    });
    const payload = { staff: normaliseStaff(staff) };
    if (shortLinkWarning) payload.short_link_warning = shortLinkWarning;
    return jsonResponse(payload, 201, request);
  } catch (err) {
    if (err.status === 404) return jsonResponse({ error: err.message }, 404, request);
    if (isUniqueViolation(err, "code")) {
      return jsonResponse({ error: `staff with code "${v.row.code}" already exists` }, 409, request);
    }
    throw err;
  }
}

export async function handleAdminStaffUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid staff id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const v = validateStaff(body, { creating: false });
  if (v.error) return jsonResponse({ error: v.error }, 400, request);
  delete v.row.code;     // slug is identity
  delete v.row.hotel_id; // can't reassign staff to a different hotel

  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`, v.row, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "staff", id, { fields: Object.keys(v.row) });
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

export async function handleAdminStaffTerminate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid staff id" }, 400, request);

  const updated = await supabaseUpdate(
    env, `hotel_staff?id=eq.${encodeURIComponent(id)}`,
    { status: "terminated" }, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "staff not found" }, 404, request);
  }
  logMutation(request, auth.claims, "terminate", "staff", id);
  return jsonResponse({ staff: normaliseStaff(updated[0]) }, 200, request);
}

export async function handleAdminHotelUserCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "valid email required" }, 400, request);
  const hotel_id = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  if (!UUID_RE.test(hotel_id)) return jsonResponse({ error: "valid hotel_id required" }, 400, request);
  const role = body.role === "admin" ? "admin" : "manager";

  try {
    const inserted = await supabaseInsert(
      env, "hotel_users",
      [{ email, hotel_id, role, status: "active" }],
      { returnRow: true },
    );
    const invite_sent = await sendManagerInvite(env, email);
    logMutation(request, auth.claims, "create", "hotel_user", inserted[0].id, {
      hotel_id, email, role,
    });
    return jsonResponse({ manager: inserted[0], invite_sent }, 201, request);
  } catch (err) {
    if (err.body && /duplicate key|unique/i.test(JSON.stringify(err.body))) {
      return jsonResponse({ error: `${email} is already an active manager for this hotel` }, 409, request);
    }
    throw err;
  }
}

// Sends a Supabase Auth invite email to a newly-added hotel manager.
// The invite link redirects to /dashboard/setup/ where they set a
// password on first sign-in. Returns true if the email was sent,
// false if the user already has a confirmed Supabase Auth account
// (they can just sign in normally) or if the invite call fails for
// any other reason (the hotel_users row is already saved either way).
async function sendManagerInvite(env, email) {
  const redirectTo = "https://gowithhorizon.com/dashboard/setup/";
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, invite: true, email_redirect_to: redirectTo }),
    });
    if (res.ok) return true;
    const text = await res.text().catch(() => "");
    // 422 = user already exists and is confirmed — no invite needed.
    if (res.status === 422 || /already (exists|registered)/i.test(text)) return false;
    console.error(`sendManagerInvite ${res.status}:`, text);
    return false;
  } catch (err) {
    console.error("sendManagerInvite failed:", err.message);
    return false;
  }
}

export async function handleAdminHotelUserUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid hotel-user id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const patch = {};
  if (typeof body.status === "string") {
    if (!MANAGER_STATUSES.has(body.status)) {
      return jsonResponse({ error: "status must be active or revoked" }, 400, request);
    }
    patch.status = body.status;
  }
  if (typeof body.role === "string") {
    if (!["manager", "admin"].includes(body.role)) {
      return jsonResponse({ error: "role must be manager or admin" }, 400, request);
    }
    patch.role = body.role;
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: "no editable fields in body" }, 400, request);
  }

  const updated = await supabaseUpdate(
    env, `hotel_users?id=eq.${encodeURIComponent(id)}`, patch, { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "hotel-user not found" }, 404, request);
  }
  logMutation(request, auth.claims, "update", "hotel_user", id, { fields: Object.keys(patch) });
  return jsonResponse({ manager: updated[0] }, 200, request);
}

// GET /api/admin/hotels/:id/short-links
//
// Returns every short_link attributable to this hotel — including
// staff-level links for any employee of the hotel. PostgREST doesn't
// support subqueries inside `or=()`, so we do two reads and merge in
// JS rather than building a database view.
export async function handleAdminHotelShortLinksList(hotelId, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(hotelId)) return jsonResponse({ error: "invalid hotel id" }, 400, request);

  const [byHotel, staffRows] = await Promise.all([
    supabaseSelect(env, `short_links?hotel_id=eq.${hotelId}&select=${SHORT_LINK_FIELDS}&order=created_at.asc`),
    supabaseSelect(env, `hotel_staff?hotel_id=eq.${hotelId}&select=id`),
  ]);
  let byStaff = [];
  if (staffRows.length) {
    const staffIds = staffRows.map((s) => s.id).join(",");
    byStaff = await supabaseSelect(
      env,
      `short_links?staff_id=in.(${staffIds})&select=${SHORT_LINK_FIELDS}&order=created_at.asc`,
    );
  }
  // De-dupe — a staff link also has hotel_id set, so the two
  // queries can return overlapping rows.
  const seen = new Set();
  const out = [];
  for (const r of [...byHotel, ...byStaff]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(normaliseShortLink(r));
  }
  return jsonResponse({ short_links: out }, 200, request);
}

// POST /api/admin/short-links
// Body: { link_type, hotel_id?, staff_id?, short_path?, target_url?,
//         label?, notes? }
// If short_path is omitted we derive one (slug for hotel, opaque code
// for staff). If target_url is omitted we derive one too. Either way
// the admin can override — useful for campaign links.
export async function handleAdminShortLinkCreate(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const linkType = typeof body.link_type === "string" ? body.link_type : "";
  if (!SHORT_LINK_TYPES.has(linkType)) {
    return jsonResponse({ error: "link_type must be hotel, staff, or campaign" }, 400, request);
  }
  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : null;
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : null;
  if (hotelId && !UUID_RE.test(hotelId)) {
    return jsonResponse({ error: "hotel_id must be a uuid" }, 400, request);
  }
  if (staffId && !UUID_RE.test(staffId)) {
    return jsonResponse({ error: "staff_id must be a uuid" }, 400, request);
  }
  if (linkType === "hotel" && !hotelId) {
    return jsonResponse({ error: "hotel link_type requires hotel_id" }, 400, request);
  }
  if (linkType === "staff" && (!staffId || !hotelId)) {
    return jsonResponse({ error: "staff link_type requires both staff_id and hotel_id" }, 400, request);
  }

  // Resolve hotel + staff rows when present so we can build a
  // sensible default short_path + target_url and reject IDs that
  // don't belong to each other.
  let hotelRow = null;
  let staffRow = null;
  if (hotelId) {
    const rows = await supabaseSelect(
      env,
      `hotels?id=eq.${hotelId}&select=id,code,name,tracking_prefix,default_tracking_code`,
    );
    if (!rows.length) return jsonResponse({ error: "hotel not found" }, 404, request);
    hotelRow = rows[0];
  }
  if (staffId) {
    const rows = await supabaseSelect(
      env,
      `hotel_staff?id=eq.${staffId}&select=id,hotel_id,name,tracking_code`,
    );
    if (!rows.length) return jsonResponse({ error: "staff not found" }, 404, request);
    staffRow = rows[0];
    if (hotelId && staffRow.hotel_id !== hotelId) {
      return jsonResponse({ error: "staff_id does not belong to hotel_id" }, 400, request);
    }
  }

  // Derive defaults — overridable by request body.
  let shortPath = typeof body.short_path === "string" ? body.short_path.trim() : "";
  if (!shortPath) {
    if (linkType === "staff" && staffRow) {
      shortPath = trackingCodeToShortPath(staffRow.tracking_code) || "";
    } else if (linkType === "hotel" && hotelRow) {
      shortPath = hotelRow.code;
    }
  }
  if (!shortPath || !SHORT_PATH_RE.test(shortPath)) {
    return jsonResponse(
      { error: "short_path missing or invalid (1–80 chars, [a-zA-Z0-9._-])" },
      400,
      request,
    );
  }

  let targetUrl = typeof body.target_url === "string" ? body.target_url.trim() : "";
  if (!targetUrl) {
    if (linkType === "staff" && hotelRow && staffRow) {
      targetUrl = staffTargetUrl(env, hotelRow.code, staffRow.tracking_code);
    } else if (linkType === "hotel" && hotelRow) {
      targetUrl = hotelTargetUrl(env, hotelRow.code);
    }
  }
  if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
    return jsonResponse({ error: "target_url missing or not http(s)" }, 400, request);
  }

  const label = typeof body.label === "string" ? body.label.trim() : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  try {
    const { link } = await mintShortLinkAndRecord(
      env,
      {
        shortPath,
        targetUrl,
        title: label,
        linkType,
        hotelId,
        staffId,
        label,
        notes,
      },
      { throwOnError: true },
    );
    logMutation(request, auth.claims, "create", "short_link", link?.id, {
      link_type: linkType, hotel_id: hotelId, staff_id: staffId, short_path: shortPath,
    });
    return jsonResponse({ short_link: normaliseShortLink(link) }, 201, request);
  } catch (err) {
    if (err instanceof ShortIoError) {
      const status = err.status === 401 ? 502 : err.status >= 400 && err.status < 600 ? err.status : 502;
      return jsonResponse({ error: `Short.io: ${err.message}` }, status, request);
    }
    if (isUniqueViolation(err, "short_path") || isUniqueViolation(err, "short_io_id")) {
      return jsonResponse({ error: "short_path already in use" }, 409, request);
    }
    throw err;
  }
}

// PATCH /api/admin/short-links/:id
// Body: { target_url?, label?, notes? }
// short_path is intentionally NOT editable here — once a QR encodes
// a short URL, the path is immutable forever. Only the destination
// and admin-facing metadata can change.
export async function handleAdminShortLinkUpdate(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid short_link id" }, 400, request);
  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  // Load the row so we know its short_io_id for the Short.io call.
  const rows = await supabaseSelect(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}&select=${SHORT_LINK_FIELDS}`,
  );
  if (!rows.length) return jsonResponse({ error: "short_link not found" }, 404, request);
  const existing = rows[0];

  const patch = {};
  const shortIoPatch = {};
  if (typeof body.target_url === "string") {
    const t = body.target_url.trim();
    if (!t || !/^https?:\/\//.test(t)) {
      return jsonResponse({ error: "target_url must be http(s)" }, 400, request);
    }
    patch.target_url = t;
    shortIoPatch.originalURL = t;
  }
  if (body.label === null) patch.label = null;
  else if (typeof body.label === "string") {
    patch.label = body.label.trim();
    shortIoPatch.title = patch.label || null;
  }
  if (body.notes === null) patch.notes = null;
  else if (typeof body.notes === "string") patch.notes = body.notes.trim();
  if (typeof body.status === "string") {
    if (!SHORT_LINK_STATUSES.has(body.status)) {
      return jsonResponse({ error: "status must be active or retired" }, 400, request);
    }
    patch.status = body.status;
  }
  if (!Object.keys(patch).length) {
    return jsonResponse({ error: "no editable fields in body" }, 400, request);
  }

  // Push the destination/title change to Short.io BEFORE we update
  // Supabase. If Short.io fails we don't want a Supabase row that
  // claims a different destination than the live redirect.
  if (Object.keys(shortIoPatch).length) {
    try {
      await updateShortLink(env, existing.short_io_id, shortIoPatch);
    } catch (err) {
      const status = err instanceof ShortIoError && err.status >= 400 && err.status < 600
        ? err.status
        : 502;
      return jsonResponse({ error: `Short.io: ${err.message}` }, status, request);
    }
  }

  const updated = await supabaseUpdate(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}`,
    patch,
    { returnRow: true },
  );
  logMutation(request, auth.claims, "update", "short_link", id, { fields: Object.keys(patch) });
  return jsonResponse({ short_link: normaliseShortLink(updated[0]) }, 200, request);
}

// DELETE /api/admin/short-links/:id
// Soft-retire only. The Short.io redirect stays alive forever so any
// printed QR codes keep resolving — they just point to whatever
// target_url the row currently has. Use the PATCH endpoint to
// re-target before retiring if you want a different destination.
export async function handleAdminShortLinkRetire(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!UUID_RE.test(id)) return jsonResponse({ error: "invalid short_link id" }, 400, request);

  const updated = await supabaseUpdate(
    env,
    `short_links?id=eq.${encodeURIComponent(id)}`,
    { status: "retired" },
    { returnRow: true },
  );
  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "short_link not found" }, 404, request);
  }
  logMutation(request, auth.claims, "retire", "short_link", id);
  return jsonResponse({ short_link: normaliseShortLink(updated[0]) }, 200, request);
}

// GET /api/admin/short-links
// Global paginated list of all short_links with optional filters.
// Query params:
//   status    — 'active' | 'retired'  (omit for all)
//   type      — 'hotel' | 'staff' | 'campaign'
//   hotel_id  — UUID
//   q         — full-text search across short_path, label, notes
//   after     — opaque cursor (base64 of "created_at|id") for next page
//   limit     — max rows per page (default 50, max 100)
// Returns { links: [...], next_cursor: string|null }
export async function handleAdminGlobalShortLinks(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  try {
    const params  = url.searchParams;
    const status  = params.get("status");
    const type    = params.get("type");
    const hotelId = params.get("hotel_id");
    const q       = (params.get("q") || "").trim();
    const after   = params.get("after");
    const limit   = Math.min(Math.max(1, parseInt(params.get("limit") || "50", 10)), 100);

    // Match the rest of the codebase: do separate queries and merge in
    // JS rather than using PostgREST resource embeds. Keeps the SQL
    // surface predictable and matches handleAdminHotelShortLinksList.
    const fields = [
      "id", "short_url", "short_path", "target_url", "label", "notes",
      "link_type", "status", "click_count_cached", "last_clicked_at",
      "created_at", "hotel_id", "staff_id",
    ].join(",");

    let qs = `short_links?select=${fields}&order=created_at.desc,id.desc&limit=${limit + 1}`;

    if (status === "active" || status === "retired") {
      qs += `&status=eq.${status}`;
    }
    if (type === "hotel" || type === "staff" || type === "campaign") {
      qs += `&link_type=eq.${type}`;
    }
    if (hotelId) {
      qs += `&hotel_id=eq.${encodeURIComponent(hotelId)}`;
    }
    if (q) {
      const safe = q.replace(/[%_]/g, "\\$&");
      qs +=
        `&or=(short_path.ilike.*${encodeURIComponent(safe)}*` +
        `,label.ilike.*${encodeURIComponent(safe)}*` +
        `,notes.ilike.*${encodeURIComponent(safe)}*)`;
    }
    if (after) {
      try {
        const decoded  = atob(after);
        const pipe     = decoded.lastIndexOf("|");
        const cursorTs = decoded.slice(0, pipe);
        const cursorId = decoded.slice(pipe + 1);
        if (cursorTs && cursorId) {
          qs +=
            `&or=(created_at.lt.${encodeURIComponent(cursorTs)}` +
            `,and(created_at.eq.${encodeURIComponent(cursorTs)},id.lt.${encodeURIComponent(cursorId)}))`;
        }
      } catch { /* ignore malformed cursor */ }
    }

    const rows    = await supabaseSelect(env, qs);
    const hasMore = rows.length > limit;
    const baseLinks = hasMore ? rows.slice(0, limit) : rows;

    // Hydrate hotel + staff names in two batched queries.
    const hotelIds = [...new Set(baseLinks.map((r) => r.hotel_id).filter(Boolean))];
    const staffIds = [...new Set(baseLinks.map((r) => r.staff_id).filter(Boolean))];
    const [hotels, staff] = await Promise.all([
      hotelIds.length
        ? supabaseSelect(env, `hotels?id=in.(${hotelIds.join(",")})&select=id,name`)
        : Promise.resolve([]),
      staffIds.length
        ? supabaseSelect(env, `hotel_staff?id=in.(${staffIds.join(",")})&select=id,name`)
        : Promise.resolve([]),
    ]);
    const hotelById = new Map(hotels.map((h) => [h.id, h]));
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const links = baseLinks.map((r) => ({
      ...r,
      hotel:         r.hotel_id ? hotelById.get(r.hotel_id) || null : null,
      staff_member:  r.staff_id ? staffById.get(r.staff_id) || null : null,
    }));

    let nextCursor = null;
    if (hasMore && links.length > 0) {
      const last = links[links.length - 1];
      nextCursor = btoa(`${last.created_at}|${last.id}`);
    }

    return jsonResponse({ links, next_cursor: nextCursor }, 200, request);
  } catch (err) {
    console.error("handleAdminGlobalShortLinks error:", err.stack || err);
    return jsonResponse({ error: "Failed to load links" }, 500, request);
  }
}

// POST /api/admin/sync-clicks
// Manually triggers the same click-count sync the cron runs hourly.
// Returns { synced, errors, total } so the admin can see progress.
export async function handleAdminSyncClicks(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  const result = await syncClickCounts(env);
  logMutation(request, auth.claims, "sync_clicks", "short_link", null, {
    synced: result?.synced, errors: result?.errors, total: result?.total,
  });
  return jsonResponse(result, 200, request);
}

// Triggers a Cloudflare Pages rebuild via the deploy hook URL stored
// as CF_PAGES_DEPLOY_HOOK on the worker. The build runs the
// `npm run build:partners` script which regenerates partners.json
// from Supabase. Propagation: ~60–120s end-to-end.
export async function handleAdminRepublish(request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;
  if (!env.CF_PAGES_DEPLOY_HOOK) {
    return jsonResponse(
      { error: "CF_PAGES_DEPLOY_HOOK not configured on worker" },
      500, request,
    );
  }
  let res;
  try {
    res = await fetch(env.CF_PAGES_DEPLOY_HOOK, { method: "POST" });
  } catch (err) {
    return jsonResponse({ error: "deploy hook fetch failed: " + err.message }, 502, request);
  }
  if (!res.ok) {
    return jsonResponse(
      { error: "deploy hook returned " + res.status },
      502, request,
    );
  }
  logMutation(request, auth.claims, "republish", "partners_json", null);
  return jsonResponse({ ok: true, triggered_at: new Date().toISOString() }, 200, request);
}

// GET /api/admin/access-requests — admin auth required.
// Returns all access requests newest-first. Optional ?status= filter.
// pending_count is returned at the top level so the nav badge can be
// populated without a separate call.
export async function handleAdminAccessRequestsList(url, env, request) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  const statusFilter = url.searchParams.get("status");
  const validStatuses = new Set(["pending", "approved", "denied"]);

  let q =
    "access_requests?select=id,email,name,property_requested,reason,status,reviewed_at,created_at" +
    "&order=created_at.desc&limit=500";
  if (statusFilter && validStatuses.has(statusFilter)) {
    q += `&status=eq.${encodeURIComponent(statusFilter)}`;
  }

  const rows = await supabaseSelect(env, q);
  const pendingCount = statusFilter
    ? null
    : rows.filter((r) => r.status === "pending").length;

  return jsonResponse({ requests: rows, pending_count: pendingCount }, 200, request);
}

// PATCH /api/admin/access-requests/:id — admin auth required.
// Sets status to approved or denied, stamps reviewed_by + reviewed_at.
export async function handleAdminAccessRequestReview(id, request, env) {
  const auth = await requireHorizonAdmin(request, env);
  if (auth.error) return auth.error;

  if (!UUID_RE.test(id)) {
    return jsonResponse({ error: "invalid access-request id" }, 400, request);
  }

  const body = await readJson(request);
  if (body.__error) return jsonResponse({ error: body.__error }, 400, request);

  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (status !== "approved" && status !== "denied") {
    return jsonResponse({ error: "status must be approved or denied" }, 400, request);
  }

  const userEmail = String(auth.claims.email || "").trim();
  const adminRows = await supabaseSelect(
    env,
    `horizon_admins?email=ilike.${encodeURIComponent(userEmail)}&status=eq.active&select=id`,
  );
  const reviewedBy = adminRows[0]?.id ?? null;

  const updated = await supabaseUpdate(
    env,
    `access_requests?id=eq.${encodeURIComponent(id)}`,
    { status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() },
    { returnRow: true },
  );

  if (!Array.isArray(updated) || !updated.length) {
    return jsonResponse({ error: "access request not found" }, 404, request);
  }
  logMutation(request, auth.claims, "review", "access_request", id, { decision: status });
  return jsonResponse({ ok: true, request: updated[0] }, 200, request);
}
