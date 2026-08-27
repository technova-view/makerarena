"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/** [Copy result] [Share] - two explicit actions rather than one button that
 * silently picks a strategy, per the product decision to keep this
 * dead-simple for the first pass (no OG images, no third-party share APIs). */
export function ShareResultActions({
  text,
  path,
  className,
}: {
  text: string;
  /** Relative path (e.g. "/products/claimone") - resolved against
   * window.location.origin at click time, so this works correctly in any
   * environment (localhost during dev, the real domain in production)
   * without needing an env var threaded through every call site. */
  path: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && Boolean(navigator.share));
  }, []);

  function resolveUrl() {
    return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  }

  async function handleCopy() {
    const url = resolveUrl();
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) - nothing more we
      // can do without a third-party dependency.
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ text, url: resolveUrl() });
    } catch {
      // User cancelled the share sheet, or it failed - no fallback needed
      // here since "Copy result" is always available right next to it.
    }
  }

  return (
    <div className={cn("flex justify-center gap-2", className)}>
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied!" : "Copy result"}
      </Button>
      {canNativeShare && (
        <Button type="button" variant="secondary" size="sm" onClick={handleShare}>
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      )}
    </div>
  );
}
