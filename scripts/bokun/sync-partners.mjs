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

const LIST_PATH = "/sales-agent.json/find-all";
const CREATE_PATH = "/sales-agent.json/create";

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
  };
}

async function listExistingAgents() {
  // Bokun returns either a bare array or { items: [...] } depending on
  // endpoint variant — handle both.
  const res = await bokunFetch("GET", LIST_PATH);
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  if (res && Array.isArray(res.results)) return res.results;
  return [];
}

function normalizeCode(s) {
  return String(s || "").trim().toUpperCase();
}

// Extract the tracking code from a Bokun sales-agent object. Different
// Bokun accounts surface it under slightly different keys, so check a
// few.
function agentTrackingCode(a) {
  return normalizeCode(
    a.trackingCode ?? a.tracking_code ?? a.code ?? a.reference ?? a.title,
  );
}

function buildCreatePayload(entry) {
  // Minimal payload that covers kickback + pool hotels. The Bokun
  // sales-agent object accepts richer fields (commissionRate, currency,
  // etc.) — leave those to be set in the Bokun extranet where
  // finance-side configuration lives.
  const payload = {
    title: entry.displayName,
    trackingCode: entry.trackingCode,
  };
  if (entry.kind === "hotel" && typeof entry.commissionPct === "number") {
    payload.commissionRate = entry.commissionPct;
  }
  if (entry.kind === "employee" && typeof entry.kickbackPct === "number") {
    payload.commissionRate = entry.kickbackPct;
  }
  return payload;
}

function manualInstructions(missing) {
  console.log("\nManual fallback (Bokun extranet):");
  console.log("  1. Log into https://extranet.bokun.io");
  console.log("  2. Open Sales → Agents (or Channels → Affiliates)");
  console.log("  3. For each row below, create a new sales agent with the");
  console.log("     EXACT trackingCode shown — spelling and case matter:");
  for (const m of missing) {
    console.log(`     • ${m.trackingCode.padEnd(24)} ${m.displayName}`);
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
  try {
    existing = await listExistingAgents();
  } catch (e) {
    console.error(`\nCould not list existing sales agents: ${e.message}`);
    if (e.status === 404) {
      console.error(
        `Endpoint ${LIST_PATH} returned 404. Your Bokun account may ` +
          "expose a different path (e.g. /affiliate.json/*). Check the " +
          "Bokun REST API reference for your account and update LIST_PATH " +
          "in scripts/bokun/sync-partners.mjs.",
      );
    }
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

  console.log("\nApplying — creating missing sales agents…");
  let created = 0;
  let failed = 0;
  const failures = [];
  for (const entry of missing) {
    const payload = buildCreatePayload(entry);
    process.stdout.write(`  + ${entry.trackingCode} … `);
    try {
      await bokunFetch("POST", CREATE_PATH, payload);
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
