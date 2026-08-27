import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/lib/actions/auth";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-1 text-2xl font-bold">Enter the arena</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Publish what you&apos;ve built and start climbing the leaderboard.
      </p>
      <AuthForm action={signUpAction} submitLabel="Sign up" next={next ?? "/"} />
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
