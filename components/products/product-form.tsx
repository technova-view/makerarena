"use client";

import { startTransition, useActionState, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import { createProduct, type ProductActionState } from "@/lib/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ImageUploader } from "@/components/products/image-uploader";

type Category = { slug: string; name: string };

const STEPS = ["Basics", "Category", "Media"] as const;

const initialState: ProductActionState = { error: null };

export function ProductForm({ categories }: { categories: Category[] }) {
  const [step, setStep] = useState(0);
  const [logoUrl, setLogoUrl] = useState<string[]>([]);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState(createProduct, initialState);

  const form = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      tagline: "",
      website_url: "",
      description: "",
      category_slug: "",
      logo_url: "",
      screenshots: [],
    },
  });

  const {
    register,
    trigger,
    handleSubmit,
    formState: { errors },
  } = form;

  async function goNext(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const fieldsByStep: Record<number, (keyof ProductInput)[]> = {
      0: ["name", "tagline", "website_url", "description"],
      1: ["category_slug"],
    };
    const valid = await trigger(fieldsByStep[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  // react-hook-form validates the whole schema here; the resulting `data` is
  // used to build the FormData ourselves rather than relying on native form
  // submission, since logo/screenshot URLs live in separate client state.
  function onValid(data: ProductInput) {
    const fd = new FormData();
    fd.set("name", data.name);
    fd.set("tagline", data.tagline ?? "");
    fd.set("website_url", data.website_url);
    fd.set("description", data.description);
    fd.set("category_slug", data.category_slug);
    fd.set("logo_url", logoUrl[0] ?? "");
    fd.set("screenshots", JSON.stringify(screenshots));
    startTransition(() => {
      formAction(fd);
    });
  }

  // Selecting a file in the logo/screenshot pickers can synthesize an Enter
  // keypress in some browsers, which would otherwise implicitly submit the
  // form early. Only let Enter through for textareas (newlines) and buttons
  // (keyboard activation of Back/Next/Submit).
  function blockImplicitSubmit(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    e.preventDefault();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {index + 1}
            </span>
            <span className={index === step ? "font-medium" : "text-muted-foreground"}>{label}</span>
            {index < STEPS.length - 1 && <span className="mx-1 text-muted-foreground">/</span>}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onValid)} onKeyDown={blockImplicitSubmit} className="space-y-4">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Product name</Label>
              <Input id="name" {...register("name")} />
              {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="tagline">Tagline (optional)</Label>
              <Input id="tagline" {...register("tagline")} placeholder="A one-line pitch" />
              {errors.tagline && <p className="mt-1 text-sm text-destructive">{errors.tagline.message}</p>}
            </div>
            <div>
              <Label htmlFor="website_url">Website URL</Label>
              <Input id="website_url" {...register("website_url")} placeholder="https://" />
              {errors.website_url && (
                <p className="mt-1 text-sm text-destructive">{errors.website_url.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" {...register("description")} rows={5} />
              {errors.description && (
                <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <Label htmlFor="category_slug">Category</Label>
            <Select id="category_slug" {...register("category_slug")}>
              <option value="">Choose a category</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
            {errors.category_slug && (
              <p className="mt-1 text-sm text-destructive">{errors.category_slug.message}</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <ImageUploader
              bucket="products"
              mode="single"
              value={logoUrl}
              onChange={setLogoUrl}
              label="Logo"
            />
            <ImageUploader
              bucket="products"
              mode="multiple"
              value={screenshots}
              onChange={setScreenshots}
              label="Screenshots (up to 5)"
            />
          </div>
        )}

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={(e) => {
              e.preventDefault();
              setStep((s) => Math.max(s - 1, 0));
            }}
            disabled={step === 0}
          >
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button type="submit" disabled={pending}>
              {pending ? "Publishing…" : "Enter the arena"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
