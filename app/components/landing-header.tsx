import Link from "next/link";
import { Calendar } from "lucide-react";
import {
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from "@clerk/nextjs";

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Calendar className="size-5" />
          </div>
          <span className="text-xl font-bold tracking-tight text-blue-600">
            Calendly
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <SignInButton
              forceRedirectUrl="/availability"
              fallbackRedirectUrl="/availability"
            >
              <button className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton
              forceRedirectUrl="/availability"
              fallbackRedirectUrl="/availability"
            >
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700">
                Get started
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
