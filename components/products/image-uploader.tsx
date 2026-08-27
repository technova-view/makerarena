"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_LOGO_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
} from "@/lib/utils/constants";

interface ImageUploaderProps {
  bucket: "products" | "avatars";
  mode: "single" | "multiple";
  value: string[];
  onChange: (urls: string[]) => void;
  label: string;
}

export function ImageUploader({ bucket, mode, value, onChange, label }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const maxBytes = mode === "single" ? MAX_LOGO_BYTES : MAX_SCREENSHOT_BYTES;
    const remainingSlots = mode === "single" ? 1 : MAX_SCREENSHOTS - value.length;
    const selected = Array.from(files).slice(0, remainingSlots);

    for (const file of selected) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setError("Only PNG, JPEG, or WebP images are allowed.");
        return;
      }
      if (file.size > maxBytes) {
        setError(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`);
        return;
      }
    }

    setUploading(true);
    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to upload images.");
        return;
      }

      const uploadedUrls: string[] = [];
      for (const file of selected) {
        const ext = file.name.split(".").pop();
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(path, file, { upsert: false });

        if (uploadError) {
          setError(uploadError.message);
          continue;
        }

        const { data: publicUrl } = supabase.storage.from(bucket).getPublicUrl(path);
        uploadedUrls.push(publicUrl.publicUrl);
      }

      if (uploadedUrls.length > 0) {
        onChange(mode === "single" ? uploadedUrls.slice(0, 1) : [...value, ...uploadedUrls]);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="mb-1.5 block text-sm font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-3">
        {value.map((url, index) => (
          <div key={url} className="relative h-20 w-20 overflow-hidden rounded-lg border border-border">
            <Image src={url} alt="" fill className="object-cover" sizes="80px" />
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {(mode === "single" ? value.length === 0 : value.length < MAX_SCREENSHOTS) && (
          <Button
            type="button"
            variant="secondary"
            className="h-20 w-20 flex-col gap-1"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="text-xs">Upload</span>
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple={mode === "multiple"}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
    </div>
  );
}
