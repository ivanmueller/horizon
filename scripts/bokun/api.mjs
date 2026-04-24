// Minimal Bokun Vendor API client.
//
// Auth: each request is signed with HMAC-SHA1 over
//   `${date}${accessKey}${METHOD}${path}`
// and sent as three headers (X-Bokun-Date, X-Bokun-AccessKey, X-Bokun-Signature).
// See https://bokun.dev/5e7ba60fbc7f37001a35fa7d/bokun-rest-api

import { createHmac } from "node:crypto";

const DEFAULT_HOST = "https://api.bokun.io";

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

export function sign({ date, accessKey, secretKey, method, path }) {
  const stringToSign = date + accessKey + method.toUpperCase() + path;
  return createHmac("sha1", secretKey).update(stringToSign).digest("base64");
}

export function env() {
  const accessKey = process.env.BOKUN_ACCESS_KEY;
  const secretKey = process.env.BOKUN_SECRET_KEY;
  const host = process.env.BOKUN_API_HOST || DEFAULT_HOST;
  if (!accessKey || !secretKey) {
    throw new Error(
      "BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY are required. " +
        "Put them in scripts/bokun/.env and run with `node --env-file=scripts/bokun/.env ...`.",
    );
  }
  return { accessKey, secretKey, host };
}

export async function bokunFetch(method, path, body) {
  const { accessKey, secretKey, host } = env();
  const date = bokunDate();
  const signature = sign({ date, accessKey, secretKey, method, path });
  const res = await fetch(host + path, {
    method,
    headers: {
      "X-Bokun-Date": date,
      "X-Bokun-AccessKey": accessKey,
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

  if (!res.ok) {
    const err = new Error(
      `Bokun ${method} ${path} → ${res.status} ${res.statusText}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`,
    );
    err.status = res.status;
    err.path = path;
    err.body = data;
    throw err;
  }

  return data;
}

// Exposed for tests / dry-runs.
export const _test = { bokunDate };
