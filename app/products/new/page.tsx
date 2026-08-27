import { CATEGORIES } from "@/lib/utils/constants";
import { ProductForm } from "@/components/products/product-form";

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Publish your product</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter the arena and see how it performs.
      </p>
      <ProductForm categories={CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }))} />
    </div>
  );
}
