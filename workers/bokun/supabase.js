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
