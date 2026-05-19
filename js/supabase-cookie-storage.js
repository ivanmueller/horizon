// Cookie-backed storage adapter for supabase-js.
//
// Why this exists: supabase-js defaults to localStorage, which is
// origin-scoped. With the auth surfaces split across
// gowithhorizon.com / connect.gowithhorizon.com / admin.gowithhorizon.com
// a localStorage session would NOT be visible across hosts, so a user
// logged in on one subdomain would look logged-out on another.
//
// Storing the session in a cookie scoped to Domain=.gowithhorizon.com
// makes one session shared by every *.gowithhorizon.com surface. On
// localhost / *.pages.dev previews we omit the Domain attribute so the
// cookie falls back to host-only and local dev keeps working.
//
// Supabase session payloads (JWT + refresh token + user object) can
// exceed the ~4KB per-cookie limit, so values are transparently split
// into numbered chunk cookies (key.0, key.1, …) and reassembled on read.

// Max length of the (URI-encoded) value portion per cookie. Kept well
// under 4096 to leave room for the name and attributes.
const MAX_CHUNK = 3200;

// One-time migration window: existing users still have their session in
// localStorage. Read through to it so the subdomain cutover doesn't sign
// everyone out — the next token refresh writes the cookie and from then
// on the cookie is authoritative.
function fromLocalStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function onHorizonDomain() {
  const h = window.location.hostname;
  return h === 'gowithhorizon.com' || h.endsWith('.gowithhorizon.com');
}

function cookieAttrs() {
  const domain = onHorizonDomain() ? '; Domain=.gowithhorizon.com' : '';
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // 400 days — the effective browser cap. Every setItem rewrites it, so
  // an in-use session keeps getting its lifetime refreshed.
  return '; Path=/; Max-Age=34560000; SameSite=Lax' + domain + secure;
}

function expireAttrs() {
  const domain = onHorizonDomain() ? '; Domain=.gowithhorizon.com' : '';
  return '; Path=/; Max-Age=0; SameSite=Lax' + domain;
}

function readJar() {
  const jar = {};
  const raw = window.document.cookie;
  if (!raw) return jar;
  for (const part of raw.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > -1) jar[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return jar;
}

function writeCookie(name, value) {
  window.document.cookie = name + '=' + value + cookieAttrs();
}

function deleteCookie(name) {
  window.document.cookie = name + '=' + expireAttrs();
}

export const cookieStorage = {
  getItem(key) {
    const jar = readJar();
    if (jar[key] !== undefined) return decodeURIComponent(jar[key]);
    if (jar[key + '.0'] !== undefined) {
      let i = 0;
      let encoded = '';
      while (jar[key + '.' + i] !== undefined) {
        encoded += jar[key + '.' + i];
        i++;
      }
      return decodeURIComponent(encoded);
    }
    return fromLocalStorage(key);
  },

  setItem(key, value) {
    // Clear any prior representation (single <-> chunked can change
    // between writes as the token size changes).
    this.removeItem(key);
    const encoded = encodeURIComponent(value);
    if (encoded.length <= MAX_CHUNK) {
      writeCookie(key, encoded);
      return;
    }
    let i = 0;
    for (let pos = 0; pos < encoded.length; pos += MAX_CHUNK) {
      writeCookie(key + '.' + i, encoded.slice(pos, pos + MAX_CHUNK));
      i++;
    }
  },

  removeItem(key) {
    const jar = readJar();
    if (jar[key] !== undefined) deleteCookie(key);
    let i = 0;
    while (jar[key + '.' + i] !== undefined) {
      deleteCookie(key + '.' + i);
      i++;
    }
  },
};
