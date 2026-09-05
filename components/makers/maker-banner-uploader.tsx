"use client";

import { ImageUploader } from "@/components/products/image-uploader";

export function MakerBannerUploader({
  value,
  onChange,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
}) {
  return (
    <ImageUploader bucket="avatars" mode="single" value={value} onChange={onChange} label="Profile banner" />
  );
}
