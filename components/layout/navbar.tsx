import Link from "next/link";
import { Swords } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils/cn";

export async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let username: string | null = null;
  if (user) {
    const { data: maker } = await supabase
      .from("makers")
      .select("username")
      .eq("id", user.id)
      .single();
    username = maker?.username ?? null;
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <Swords className="h-5 w-5 text-primary" />
          MakerArena
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/arena" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Arena
          </Link>
          <Link href="/categories" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Categories
          </Link>
          <Link href="/makers" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Top Makers
          </Link>

          {user ? (
            <>
              <Link href="/products/new" className="hidden text-muted-foreground hover:text-foreground sm:inline">
                Publish
              </Link>
              {username && (
                <Link href={`/makers/${username}`} className="text-muted-foreground hover:text-foreground">
                  Profile
                </Link>
              )}
              <form action={signOutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Link
                href="/signup"
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90",
                )}
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
