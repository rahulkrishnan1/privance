import { Logo } from "./Logo";
import { Spinner } from "./Spinner";

export function RouteLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-vault px-6 text-cream">
      <div role="status" className="flex items-center gap-3 font-mono text-xs text-dim">
        <Logo className="size-6" />
        <Spinner className="size-4 text-accent" />
        <span className="sr-only">Loading Privance</span>
      </div>
    </main>
  );
}
