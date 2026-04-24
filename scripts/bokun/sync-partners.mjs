// Ensures every active hotel + employee in partners.json has a
// corresponding sales-agent / referral partner registered in Bokun
// under the exact tracking code from the naming convention.
//
// Modes:
//   (default)   Plan only. Lists existing partners, diffs against
//               partners.json, prints the set that needs to be created.
//   --apply     Attempts creation via the Bokun sales-agent API for
//               each missing tracking code.
//
// Usage:
//   node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs
//   node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs --apply

import { bokunFetch } from "./api.mjs";
import { expectedTrackingCodes } from "./partners.mjs";

// Bokun exposes partner / agent / referral management under different
// paths depending on account tier and which subsystem is enabled.
// Try them in order. First non-404 wins. The Horizon Tours account
// uses Settings → Referral tracking, so referral.json variants come
// first. Override with --list-path=... / --create-path=... if your
// account uses something else.
const CANDIDATE_LIST_PATHS = [
  "/referral.json/find-all",
  "/referral.json/list",
  "/referral-tracking.json/find-all",
  "/referral-tracking.json/list",
  "/extranet/referral.json/find-all",
  "/extranet/referral-tracking.json/find-all",
  "/sales-agent.json/find-all",
  "/sales-agent.json/list",
  "/extranet/sales-agent.json/find-all",
  "/affiliate.json/find-all",
  "/channel.json/find-all",
  "/booking-channel.json/find-all",
];
const DEFAULT_CREATE_PATH = "/referral.json/create";

function parseArgs(argv) {
  const out = { apply: false, listPath: null, createPath: null };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    const lp = a.match(/^--list-path=(.+)$/);
    if (lp) out.listPath = lp[1];
    const cp = a.match(/^--create-path=(.+)$/);
    if (cp) out.createPath = cp[1];
  }
  return out;
}

function unwrapList(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  if (res && Array.isArray(res.results)) return res.results;
  return [];
}

// Probe candidate list paths until one returns a non-404. Returns
// { path, agents } on success, throws the last error otherwise.
async function discoverAndList(explicitPath) {
  const paths = explicitPath ? [explicitPath] : CANDIDATE_LIST_PATHS;
  let lastErr;
  for (const p of paths) {
    try {
      const res = await bokunFetch("GET", p);
      return { path: p, agents: unwrapList(res) };
    } catch (e) {
      lastErr = e;
      if (e.status === 404) continue; // try the next candidate
      throw e; // 401/403/5xx — bail, that's a real problem
    }
  }
  throw lastErr;
}

function normalizeCode(s) {
  return String(s || "").trim().toUpperCase();
}

// Extract the tracking code from a Bokun referral / agent object.
// The extranet form labels this "Identification number" — that's the
// field bookings get matched against. Different endpoints serialize
// it under different keys, so check the likely ones in order.
function agentTrackingCode(a) {
  return normalizeCode(
    a.identificationNumber ??
      a.identification_number ??
      a.trackingCode ??
      a.tracking_code ??
      a.code ??
      a.reference ??
      a.title,
  );
}

function buildCreatePayload(entry) {
  // Mirrors the Settings → Referral tracking form. Title + Identification
  // number + Commission are the only fields that affect attribution;
  // tax/email/flags can stay extranet-managed.
  const payload = {
    title: entry.displayName,
    identificationNumber: entry.trackingCode,
  };
  if (entry.kind === "hotel" && typeof entry.commissionPct === "number") {
    payload.commission = entry.commissionPct;
  }
  if (entry.kind === "employee" && typeof entry.kickbackPct === "number") {
    payload.commission = entry.kickbackPct;
  }
  return payload;
}

function manualInstructions(missing) {
  console.log("\nManual fallback (Bokun extranet):");
  console.log("  1. Log into https://extranet.bokun.io");
  console.log("  2. Settings → Referral tracking → Create a Referral tracking");
  console.log("  3. For each row below, create one entry. Identification");
  console.log("     number must be EXACT — it's what bookings match on.");
  console.log("     Title is shown in reports; commission is the % rate.");
  console.log("");
  console.log("       Identification number    Commission   Title");
  for (const m of missing) {
    const pct = m.kind === "hotel" ? m.commissionPct : m.kickbackPct;
    console.log(
      `     • ${m.trackingCode.padEnd(24)} ${String(pct ?? "").padEnd(12)} ${m.displayName}`,
    );
  }
  console.log("  4. Re-run this script to confirm:");
  console.log("       node --env-file=scripts/bokun/.env scripts/bokun/sync-partners.mjs");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("Bokun referral-partner sync");
  console.log("===========================\n");

  const expected = expectedTrackingCodes();
  console.log(`Expected from partners.json: ${expected.length} tracking codes`);
  for (const e of expected) {
    console.log(`  ${e.trackingCode.padEnd(24)} ${e.displayName}`);
  }

  let existing;
  let listPath;
  try {
    const r = await discoverAndList(args.listPath);
    existing = r.agents;
    listPath = r.path;
    console.log(`\nListed sales agents via: ${listPath}`);
  } catch (e) {
    if (e.status === 404) {
      console.log(
        "\nNo partner-management endpoint responded — Bokun's Vendor REST API " +
          "on this account does not expose sales-agent / affiliate / channel CRUD.",
      );
      console.log(
        "This is normal on many tiers. Partner registration is then a manual " +
          "extranet operation; the script can still verify codes are present " +
          "once you re-run with --list-path=<path-Bokun-support-confirmed>.",
      );
      manualInstructions(expected);
      process.exit(1);
    }
    console.error(`\nCould not list existing sales agents: ${e.message}`);
    manualInstructions(expected);
    process.exit(1);
  }

  const existingByCode = new Map();
  for (const a of existing) {
    const code = agentTrackingCode(a);
    if (code) existingByCode.set(code, a);
  }

  console.log(`\nExisting sales agents in Bokun: ${existing.length}`);
  if (existing.length) {
    for (const a of existing.slice(0, 20)) {
      const code = agentTrackingCode(a) || "(no code)";
      console.log(`  ${code.padEnd(24)} ${a.title || a.name || ""}`);
    }
    if (existing.length > 20) console.log(`  … and ${existing.length - 20} more`);
  }

  const missing = expected.filter((e) => !existingByCode.has(e.trackingCode));
  const present = expected.filter((e) => existingByCode.has(e.trackingCode));

  console.log(`\nAlready registered: ${present.length}`);
  for (const p of present) console.log(`  ✓ ${p.trackingCode}`);
  console.log(`Missing: ${missing.length}`);
  for (const m of missing) console.log(`  ✗ ${m.trackingCode}   (${m.displayName})`);

  if (missing.length === 0) {
    console.log("\nAll partners in partners.json are registered in Bokun. ✓");
    return;
  }

  if (!args.apply) {
    console.log("\nRun again with --apply to attempt creation via the Bokun API.");
    manualInstructions(missing);
    process.exit(1);
  }

  const createPath = args.createPath || DEFAULT_CREATE_PATH;
  console.log(`\nApplying — POST ${createPath} for each missing entry…`);
  let created = 0;
  let failed = 0;
  const failures = [];
  for (const entry of missing) {
    const payload = buildCreatePayload(entry);
    process.stdout.write(`  + ${entry.trackingCode} … `);
    try {
      await bokunFetch("POST", createPath, payload);
      console.log("created");
      created++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failures.push({ entry, error: e.message });
      failed++;
    }
  }

  console.log(`\nCreated ${created}/${missing.length}. ${failed} failed.`);
  if (failed > 0) {
    manualInstructions(failures.map((f) => f.entry));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nFatal error:");
  console.error(e.message);
  if (e.status === 401 || e.status === 403) {
    console.error(
      "\nAuth failure — double-check BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY.",
    );
  }
  process.exit(1);
});
