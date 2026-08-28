"use client";

import { startTransition, useActionState } from "react";
import { Archive } from "lucide-react";
import { archiveProduct, type ArchiveActionState } from "@/lib/actions/products";
import { Button } from "@/components/ui/button";

const initialState: ArchiveActionState = { error: null };

export function ArchiveProductButton({ productId, productName }: { productId: string; productName: string }) {
  const [state, formAction, pending] = useActionState(archiveProduct, initialState);

  function handleClick() {
    if (
      !window.confirm(
        `Archive "${productName}"? It will stop appearing in the Arena and leaderboards, but its battle history stays intact. This can't be undone from here.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("product_id", productId);
    startTransition(() => {
      formAction(fd);
    });
  }

  return (
    <div>
      <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={handleClick}>
        <Archive className="h-3.5 w-3.5" />
        {pending ? "Archiving…" : "Archive product"}
      </Button>
      {state.error && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
