#!/usr/bin/env node
/**
 * DEV-ONLY cleanup tool. Deletes auth users whose email contains a given
 * substring, plus everything that cascades from them (makers -> products),
 * any votes referencing those products (deleted first - votes have no
 * cascade FK to products, by design, so they'd otherwise block the delete),
 * and any Storage objects under each deleted maker's folder
 * (avatars/<id>/..., products/<id>/...).
 *
 * Requires an explicit, non-empty pattern argument every time - there is no
 * "delete everything" mode. This is the guardrail against ever sweeping up
 * a real user by accident.
 *
 * Usage:
 *   node scripts/dev-cleanup-test-users.js "+sim_"
 *   node scripts/dev-cleanup-test-users.js "+arena_test" --dry-run
 *
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
    if (match) env[match[1]] = match[2];
  }
  return env;
}

async function main() {
  const pattern = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!pattern || pattern.trim().length < 3) {
    console.error(
      "Refusing to run: pass an explicit email-substring pattern (min 3 chars), e.g.:\n" +
        '  node scripts/dev-cleanup-test-users.js "+sim_"',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  async function api(pathSuffix, opts = {}) {
    const res = await fetch(`${SUPABASE_URL}${pathSuffix}`, {
      ...opts,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...opts.headers,
      },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  }

  console.log(`Pattern: "${pattern}"${dryRun ? " (dry run - no deletions)" : ""}`);

  const { body: userList } = await api("/auth/v1/admin/users?per_page=1000");
  const allUsers = userList.users || userList;
  const targets = allUsers.filter((u) => u.email && u.email.includes(pattern));

  console.log(`Found ${targets.length} matching user(s) out of ${allUsers.length} total.`);
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  targets.forEach((u) => console.log(`  - ${u.email} (${u.id})`));

  if (dryRun) {
    console.log("\nDry run - stopping before any deletion.");
    return;
  }

  const makerIds = targets.map((u) => u.id);

  // Products owned by these makers, so we know what to clear from votes and
  // Storage before the cascade deletes them.
  const { body: products } = await api(
    `/rest/v1/products?select=id&maker_id=in.(${makerIds.join(",")})`,
  );
  const productIds = (products || []).map((p) => p.id);
  console.log(`\nFound ${productIds.length} product(s) owned by these makers.`);

  if (productIds.length > 0) {
    const orFilter = productIds
      .map((id) => `winner_product_id.eq.${id},loser_product_id.eq.${id}`)
      .join(",");
    const { status } = await api(`/rest/v1/votes?or=(${orFilter})`, { method: "DELETE" });
    console.log(`Deleted votes referencing these products: status ${status}`);

    // season_results.product_id/maker_id have no cascade (same reasoning
    // as votes above - it's a permanent archive, not meant to silently
    // lose rows when an account is deleted), so it would otherwise block
    // the products -> makers -> auth.users cascade below.
    const { status: srStatus } = await api(
      `/rest/v1/season_results?product_id=in.(${productIds.join(",")})`,
      { method: "DELETE" },
    );
    console.log(`Deleted season_results referencing these products: status ${srStatus}`);
  }

  // Best-effort Storage cleanup - list then delete each maker's folder in
  // both buckets. Not fatal if a maker never uploaded anything.
  for (const bucket of ["avatars", "products"]) {
    for (const makerId of makerIds) {
      const { body: files } = await api(`/storage/v1/object/list/${bucket}`, {
        method: "POST",
        body: JSON.stringify({ prefix: `${makerId}/` }),
      });
      if (Array.isArray(files) && files.length > 0) {
        const toRemove = files.map((f) => `${makerId}/${f.name}`);
        await api(`/storage/v1/object/${bucket}`, {
          method: "DELETE",
          body: JSON.stringify({ prefixes: toRemove }),
        });
        console.log(`Removed ${toRemove.length} file(s) from ${bucket}/${makerId}/`);
      }
    }
  }

  console.log("\nDeleting auth users (cascades: auth.users -> makers -> products)...");
  for (const user of targets) {
    const { status } = await api(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    console.log(`  ${user.email}: ${status}`);
  }

  console.log("\n=== Post-cleanup counts ===");
  const tables = [
    ["makers", "id"], ["products", "id"], ["votes", "id"],
    ["subscriptions", "id"], ["payments", "id"], ["featured_campaigns", "id"],
    ["categories", "slug"], // categories' PK is slug, not id
  ];
  for (const [table, pk] of tables) {
    const { body } = await api(`/rest/v1/${table}?select=${pk}`);
    console.log(`  ${table}: ${Array.isArray(body) ? body.length : "?"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
