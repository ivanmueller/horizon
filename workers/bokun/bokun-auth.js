// Bokun HMAC-SHA1 signing — Web Crypto edition.
//
// String to sign:  `${date}${accessKey}${METHOD}${path}`
// Date format:      yyyy-MM-dd HH:mm:ss in UTC
// Path:             includes the query string exactly as sent
// Required headers: X-Bokun-AccessKey, X-Bokun-Date, X-Bokun-Signature
//
// Functionally equivalent to scripts/bokun/api.mjs (Node createHmac).
// We re-implement here because Cloudflare Workers can't import Node's
// crypto module — they expose Web Crypto via the global `crypto` object.

function bokunDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getUTCFullYear() +
    "-" +
    pad(now.getUTCMonth() + 1) +
    "-" +
    pad(now.getUTCDate()) +
    " " +
    pad(now.getUTCHours()) +
    ":" +
    pad(now.getUTCMinutes()) +
    ":" +
    pad(now.getUTCSeconds())
  );
}

async function sign({ date, accessKey, secretKey, method, path }) {
  const stringToSign = date + accessKey + method.toUpperCase() + path;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  return btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
}

export async function bokunFetch(method, path, body, env) {
  if (!env.BOKUN_ACCESS_KEY || !env.BOKUN_SECRET_KEY) {
    throw new Error("BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY secrets are not set on the Worker.");
  }
  const date = bokunDate();
  const signature = await sign({
    date,
    accessKey: env.BOKUN_ACCESS_KEY,
    secretKey: env.BOKUN_SECRET_KEY,
    method,
    path,
  });

  const res = await fetch(env.BOKUN_API_BASE + path, {
    method,
    headers: {
      "X-Bokun-Date": date,
      "X-Bokun-AccessKey": env.BOKUN_ACCESS_KEY,
      "X-Bokun-Signature": signature,
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

  return { ok: res.ok, status: res.status, statusText: res.statusText, data };
}
