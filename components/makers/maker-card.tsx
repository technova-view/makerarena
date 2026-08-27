import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";

export interface MakerCardData {
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
}

export function MakerCard({ maker }: { maker: MakerCardData }) {
  return (
    <Link href={`/makers/${maker.username}`}>
      <Card className="flex items-center gap-3 p-4 transition-colors hover:border-primary">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
          {maker.avatar_url ? (
            <Image
              src={maker.avatar_url}
              alt={maker.display_name}
              width={48}
              height={48}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-lg font-semibold text-muted-foreground">
              {maker.display_name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{maker.display_name}</p>
          <p className="truncate text-sm text-muted-foreground">@{maker.username}</p>
        </div>
      </Card>
    </Link>
  );
}
