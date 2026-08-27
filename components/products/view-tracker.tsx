"use client";

import { useEffect, useRef } from "react";

export function ViewTracker({ productId }: { productId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    fetch(`/api/products/${productId}/view`, { method: "POST" }).catch(() => {
      // View counting is best-effort; a failure here shouldn't affect the page.
    });
  }, [productId]);

  return null;
}
