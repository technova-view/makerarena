export const CATEGORIES = [
  { slug: "saas", name: "SaaS" },
  { slug: "ai", name: "AI" },
  { slug: "developer-tools", name: "Developer Tools" },
  { slug: "design", name: "Design" },
  { slug: "mobile", name: "Mobile" },
  { slug: "productivity", name: "Productivity" },
  { slug: "open-source", name: "Open Source" },
  { slug: "games", name: "Games" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export const DEFAULT_RATING = 1500;

export const MAX_SCREENSHOTS = 5;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
