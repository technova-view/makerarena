import "server-only";
import { Polar } from "@polar-sh/sdk";

// Defaults to sandbox unless POLAR_SERVER is explicitly "production" - a
// missing/misconfigured env var should never accidentally point checkout
// creation at real money (see app/api/webhooks/polar/route.ts for the
// webhook-receiving half of this integration).
export function createPolarClient() {
  return new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox",
  });
}
