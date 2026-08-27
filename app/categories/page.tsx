import Link from "next/link";
import { CATEGORIES } from "@/lib/utils/constants";
import { Card } from "@/components/ui/card";

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Categories</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {CATEGORIES.map((category) => (
          <Link key={category.slug} href={`/categories/${category.slug}`}>
            <Card className="p-4 text-center font-medium transition-colors hover:border-primary">
              {category.name}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
