import Link from "next/link";
import { Logo } from "@/components/index";

// Shared glow + safe-area header for the auth and unlock screens.
export function AuthBackdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed w-[900px] h-[900px] rounded-full"
        style={{
          left: "50%",
          top: -480,
          transform: "translateX(-50%)",
          background: "radial-gradient(circle, rgba(127,196,198,.07), transparent 62%)",
          zIndex: 0,
        }}
      />
      <header className="px-8 pb-[26px] [padding-top:calc(26px+env(safe-area-inset-top))] flex justify-between items-center relative z-10">
        <Link
          href="/"
          aria-label="Back to home"
          className="flex items-center gap-[9px] no-underline font-serif text-[22px] text-cream hover:opacity-80 transition-opacity"
        >
          <Logo size={24} className="text-cream flex-none" />
          Privance
        </Link>
      </header>
    </>
  );
}
