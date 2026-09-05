#!/usr/bin/env node
/**
 * DEV-ONLY, one-shot live verification for 0017_product_slots.sql, run
 * directly against the real Supabase project (there is no other one - see
 * TECH_DEBT.md). Creates exactly one test maker (email contains
 * "+slot_test_", the same pattern dev-cleanup-test-users.js expects), drives
 * it through every transition in the checklist below, asserts the expected
 * outcome at each step, and deletes the test maker (cascades to
 * products/subscriptions/entitlements) at the end regardless of pass/fail.
 *
 * Usage: node scripts/dev-verify-product-slots.js
 * Reads Supabase credentials from .env.local in the project root.
 */

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(pathSuffix, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathSuffix}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.method === "POST" ? "return=representation" : undefined,
      ...opts.headers,
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function insertProduct(makerId, categorySlug, slug, status) {
  return api("/rest/v1/products", {
    method: "POST",
    body: JSON.stringify({
      maker_id: makerId,
      category_slug: categorySlug,
      name: slug,
      slug,
      description: "slot-limit verification product",
      website_url: "https://example.com",
      status,
    }),
  });
}

async function slotLimit(makerId) {
  const { body } = await api("/rest/v1/rpc/current_product_slot_limit", {
    method: "POST",
    body: JSON.stringify({ p_maker_id: makerId }),
  });
  return body;
}

// Throws on any non-200 - a silently-swallowed failed grant (e.g. the
// subscriptions_single_active_idx violation you get from granting a second
// "active" subscription for the same maker without ending the prior one
// first) must never be mistaken for "the limit computed something else."
async function grantSubscription(makerId, subId, status, periodStartMs, periodEndMs) {
  const result = await api("/rest/v1/rpc/apply_subscription_event", {
    method: "POST",
    body: JSON.stringify({
      p_maker_id: makerId,
      p_provider_subscription_id: subId,
      p_provider_customer_id: `cus_${subId}`,
      p_plan: "pro",
      p_status: status,
      p_current_period_start: new Date(periodStartMs).toISOString(),
      p_current_period_end: new Date(periodEndMs).toISOString(),
      p_cancel_at_period_end: status !== "active",
    }),
  });
  if (result.status !== 200) {
    throw new Error(`apply_subscription_event(${subId}, ${status}) failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result;
}

async function entitlementRows(makerId) {
  const { body } = await api(
    `/rest/v1/entitlements?maker_id=eq.${makerId}&select=type,value,effective_at,expires_at,subscription_id&order=effective_at.asc`,
  );
  return body;
}

async function main() {
  const runId = Date.now().toString(36);
  const email = `slot-test+slot_test_${runId}@example.com`;

  console.log(`=== 0017_product_slots.sql live verification (run ${runId}) ===\n`);

  console.log("Setup: creating test maker...");
  const { status: createStatus, body: createBody } = await api("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: `Slot-Test-${runId}!`, email_confirm: true }),
  });
  if (createStatus >= 300) throw new Error(`user creation failed: ${createStatus} ${JSON.stringify(createBody)}`);
  const makerId = createBody.id;
  console.log(`  maker_id = ${makerId} (${email})`);

  const { body: categories } = await api("/rest/v1/categories?select=slug&limit=1");
  const categorySlug = categories[0].slug;
  console.log(`  using category = ${categorySlug}\n`);

  try {
    // --- Phase A: free tier baseline ---------------------------------
    console.log("Phase A — free tier baseline");
    check("limit = 1 for a fresh free maker", (await slotLimit(makerId)) === 1);

    const p1 = await insertProduct(makerId, categorySlug, `slot-${runId}-p1`, "published");
    check("first product (published) succeeds", p1.status === 201, JSON.stringify(p1.body));

    const p2 = await insertProduct(makerId, categorySlug, `slot-${runId}-p2`, "draft");
    check(
      "second product (draft) is rejected at the free limit",
      p2.status >= 400 && JSON.stringify(p2.body).includes("product limit"),
      JSON.stringify(p2.body),
    );

    const archiveP1 = await api(`/rest/v1/products?id=eq.${p1.body[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    check("archiving product 1 succeeds", archiveP1.status === 200 || archiveP1.status === 204);

    const p3 = await insertProduct(makerId, categorySlug, `slot-${runId}-p3`, "published");
    check("after archiving, a new product succeeds (slot freed)", p3.status === 201, JSON.stringify(p3.body));

    // --- Phase B: activate Pro (short period so we can watch it expire) ---
    console.log("\nPhase B — activate Pro (5s period, for real-time expiry testing)");
    const now = Date.now();
    const subA = `sub_test_${runId}_A`;
    const grantA = await grantSubscription(makerId, subA, "active", now, now + 5000);
    check("apply_subscription_event(active) succeeds", grantA.status === 200, JSON.stringify(grantA.body));
    check("limit = 3 once Pro is active", (await slotLimit(makerId)) === 3);

    const p4 = await insertProduct(makerId, categorySlug, `slot-${runId}-p4`, "published");
    const p5 = await insertProduct(makerId, categorySlug, `slot-${runId}-p5`, "published");
    check("2nd active product under Pro succeeds", p4.status === 201, JSON.stringify(p4.body));
    check("3rd active product under Pro succeeds", p5.status === 201, JSON.stringify(p5.body));

    const p6 = await insertProduct(makerId, categorySlug, `slot-${runId}-p6`, "published");
    check(
      "4th active product is rejected at the Pro limit",
      p6.status >= 400 && JSON.stringify(p6.body).includes("product limit"),
      JSON.stringify(p6.body),
    );

    // --- Phase C: idempotency ------------------------------------------
    console.log("\nPhase C — re-applying the same subscription event is idempotent");
    const beforeRows = await entitlementRows(makerId);
    await grantSubscription(makerId, subA, "active", now, now + 5000); // same period_start -> same effective_at
    const afterRows = await entitlementRows(makerId);
    check(
      "entitlement row count unchanged after replaying the same event",
      afterRows.length === beforeRows.length,
      `before=${beforeRows.length} after=${afterRows.length}`,
    );
    check(
      "exactly one pro_access + one product_slots row exist",
      afterRows.filter((r) => r.type === "pro_access").length === 1 &&
        afterRows.filter((r) => r.type === "product_slots").length === 1,
      JSON.stringify(afterRows),
    );

    // --- Phase D: cancellation is scheduled, access continues until period end ---
    console.log("\nPhase D — cancel_at_period_end: access continues until the period actually ends");
    await grantSubscription(makerId, subA, "canceled", now, now + 5000);
    check("limit is still 3 immediately after a scheduled cancellation", (await slotLimit(makerId)) === 3);

    console.log("  waiting for the 5s period to actually elapse...");
    await sleep(5500);
    check("limit falls back to 1 once the period genuinely expires", (await slotLimit(makerId)) === 1);

    const { body: survivors } = await api(
      `/rest/v1/products?maker_id=eq.${makerId}&status=eq.published&select=slug`,
    );
    check(
      "the 3 products created while Pro remain published after downgrade (no retroactive archiving)",
      survivors.length === 3,
      JSON.stringify(survivors),
    );

    // --- Phase E: an older expired grant cannot resurrect itself ---------
    console.log("\nPhase E — a second, shorter Pro period expires too; neither expired grant re-activates");
    const now2 = Date.now();
    const subB = `sub_test_${runId}_B`;
    await grantSubscription(makerId, subB, "active", now2, now2 + 3000);
    check("limit = 3 again under the new (subB) grant", (await slotLimit(makerId)) === 3);

    console.log("  waiting for the second period to elapse...");
    await sleep(3500);
    const limitAfterBothExpired = await slotLimit(makerId);
    check(
      "limit = 1 with two expired product_slots grants on record (subA and subB, neither picked)",
      limitAfterBothExpired === 1,
      `got ${limitAfterBothExpired}`,
    );
    const rows = await entitlementRows(makerId);
    const expiredSlotRows = rows.filter((r) => r.type === "product_slots");
    check(
      "both product_slots grants are on record and both are in the past",
      expiredSlotRows.length === 2 && expiredSlotRows.every((r) => new Date(r.expires_at).getTime() < Date.now()),
      JSON.stringify(expiredSlotRows),
    );

    // --- Phase F: concurrent inserts cannot exceed the limit --------------
    console.log("\nPhase F — concurrency: N simultaneous inserts against 1 free slot");
    // subB is still sitting in `subscriptions` with status='active' (its
    // ENTITLEMENT expired, but nothing ever told the subscriptions mirror
    // it ended - real Polar would send subscription.canceled for that;
    // there is no 'revoked' status value - see 0013's comment on why that's
    // an event name, not a resting status). subscriptions_single_active_idx
    // correctly refuses a second concurrently-active row per maker, so subC
    // must not go active until subB is explicitly ended first.
    await grantSubscription(makerId, subB, "canceled", now2, now2 + 3000);
    const subC = `sub_test_${runId}_C`;
    const now3 = Date.now();
    await grantSubscription(makerId, subC, "active", now3, now3 + 60000);
    check("limit = 3 again under subC (long enough to run the race test)", (await slotLimit(makerId)) === 3);

    // Free exactly one slot: 3 published products exist (p3,p4,p5) - archive one.
    const { body: current } = await api(
      `/rest/v1/products?maker_id=eq.${makerId}&status=eq.published&select=id&limit=1`,
    );
    await api(`/rest/v1/products?id=eq.${current[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    const { body: activeBeforeRace } = await api(
      `/rest/v1/products?maker_id=eq.${makerId}&status=eq.published&select=id`,
    );
    check(
      "exactly 1 free slot before the race (limit 3, 2 active)",
      (await slotLimit(makerId)) === 3 && activeBeforeRace.length === 2,
      `active=${activeBeforeRace.length}`,
    );

    const race = await Promise.all(
      Array.from({ length: 5 }, (_, i) => insertProduct(makerId, categorySlug, `slot-${runId}-race-${i}`, "published")),
    );
    const successes = race.filter((r) => r.status === 201).length;
    check("exactly 1 of 5 concurrent inserts against 1 free slot succeeds", successes === 1, `got ${successes}`);

    const { body: finalActive } = await api(
      `/rest/v1/products?maker_id=eq.${makerId}&status=eq.published&select=id`,
    );
    check("active product count never exceeds the limit (3) after the race", finalActive.length === 3, `got ${finalActive.length}`);
  } finally {
    console.log("\nCleanup: deleting test maker (cascades products/subscriptions/entitlements)...");
    const { status } = await api(`/auth/v1/admin/users/${makerId}`, { method: "DELETE" });
    console.log(`  delete auth user ${makerId}: status ${status}`);

    const { body: leftoverProducts } = await api(`/rest/v1/products?maker_id=eq.${makerId}&select=id`);
    const { body: leftoverEnt } = await api(`/rest/v1/entitlements?maker_id=eq.${makerId}&select=id`);
    const { body: leftoverSubs } = await api(`/rest/v1/subscriptions?maker_id=eq.${makerId}&select=id`);
    console.log(
      `  post-cleanup: products=${leftoverProducts.length} entitlements=${leftoverEnt.length} subscriptions=${leftoverSubs.length}`,
    );
  }

  console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("VERIFICATION SCRIPT ERROR:", err);
  process.exit(1);
});
