// Minimal PostgREST client for the Supabase booking ledger.
//
// No SDK on purpose — keeps the worker bundle small and the surface area
// obvious. The service_role key bypasses Row-Level Security; this module
// must never be reachable from a browser.
//
// Configuration:
//   SUPABASE_URL          — [vars] entry in wrangler.toml (non-secret)
//   SUPABASE_SERVICE_KEY  — wrangler secret (set via `wrangler secret put`)

export async function supabaseRequest(env, method, path, opts = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured on the worker");
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (opts.prefer) headers.Prefer = opts.prefer;

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = new Error(`Supabase ${method} ${path} → ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// SELECT helper. Caller builds the query string (filters, embeds, etc.)
// to keep the helper dumb and the call site readable. Example:
//   supabaseSelect(env, "hotels?code=eq.fairmont-ll&select=id,name")
export function supabaseSelect(env, tableAndQuery) {
  return supabaseRequest(env, "GET", `/${tableAndQuery}`);
}

// INSERT helper with optional upsert. When onConflict is set, PostgREST
// merges duplicates on that column; pass returnRow=true to get the row
// back (default is return=minimal for cheaper writes).
export function supabaseInsert(env, table, rows, { onConflict, returnRow = false } = {}) {
  const path = onConflict ? `/${table}?on_conflict=${onConflict}` : `/${table}`;
  const preferParts = [];
  if (onConflict) preferParts.push("resolution=merge-duplicates");
  preferParts.push(returnRow ? "return=representation" : "return=minimal");
  return supabaseRequest(env, "POST", path, {
    body: rows,
    prefer: preferParts.join(","),
  });
}

// UPDATE helper. Caller passes the table + filter as a single string
// (`bookings?id=eq.<uuid>`) so the call site stays explicit about which
// rows are being mutated. Pass returnRow=true to get the updated row(s)
// back; default is return=minimal.
export function supabaseUpdate(env, tableAndQuery, patch, { returnRow = false } = {}) {
  return supabaseRequest(env, "PATCH", `/${tableAndQuery}`, {
    body: patch,
    prefer: returnRow ? "return=representation" : "return=minimal",
  });
}

// ── Storage (S3-compatible object store) ────────────────────────────
// Same project, different API root (/storage/v1 instead of /rest/v1).
// The service_role key is used here too — it bypasses Storage RLS, so
// this module must never be reachable from a browser. Buckets are
// private; browsers only ever touch short-lived signed URLs minted
// below, never the service key.
async function supabaseStorageRequest(env, method, path, body) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured on the worker");
  }
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const err = new Error(`Supabase storage ${method} ${path} → ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// Mint a one-shot signed URL the browser can PUT a file to without
// ever seeing the service key. Returns { url, token, path } — `url`
// is project-absolute and ready to PUT to.
export async function supabaseStorageSignUpload(env, bucket, objectPath) {
  const data = await supabaseStorageRequest(
    env,
    "POST",
    `/object/upload/sign/${bucket}/${objectPath}`,
  );
  // Supabase returns { url: "/object/upload/sign/<bucket>/<path>?token=..." }
  const rel = data && data.url ? data.url : "";
  return {
    url: `${env.SUPABASE_URL}/storage/v1${rel}`,
    token: data && data.token ? data.token : null,
    path: objectPath,
  };
}

// Mint a short-lived signed GET URL for previewing/downloading a
// private object. expiresIn is seconds.
export async function supabaseStorageSignDownload(env, bucket, objectPath, expiresIn = 3600) {
  const data = await supabaseStorageRequest(
    env,
    "POST",
    `/object/sign/${bucket}/${objectPath}`,
    { expiresIn },
  );
  const rel = data && data.signedURL ? data.signedURL : "";
  return rel ? `${env.SUPABASE_URL}/storage/v1${rel}` : null;
}
