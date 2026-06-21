"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Logo } from "@/components/index";
import { useAuth } from "@/providers/auth-context";

// useLayoutEffect on the server logs a warning; fall back to useEffect there.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const NAV_LINKS = [
  { label: "Tenets", href: "#tenets" },
  { label: "Protocol", href: "#protocol" },
  { label: "Self‑host", href: "#deploy" },
  { label: "Features", href: "#features" },
];

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789+/=";
function randStr(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return s;
}

function NavBar() {
  return (
    <header className="sticky top-0 z-30 bg-vault/86 backdrop-blur-[12px] border-b border-line-soft [padding-top:env(safe-area-inset-top)]">
      <div className="max-w-[1160px] mx-auto px-8 h-[66px] flex items-center justify-between">
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex items-center gap-[10px] no-underline font-serif text-[23px] text-cream"
          aria-label="Privance"
        >
          <Logo size={26} className="text-cream flex-none" aria-hidden={true} />
          <span aria-hidden="true">Privance</span>
        </Link>

        <nav aria-label="Sections" className="hidden md:flex gap-[30px]">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] tracking-[0.16em] uppercase text-dim hover:text-accent transition-colors no-underline"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <Link
          href="/auth/login"
          className="font-mono text-[11px] tracking-[0.12em] uppercase font-medium bg-accent text-vault no-underline px-5 py-[11px] rounded-[6px] hover:bg-cream transition-colors max-[560px]:px-[14px] max-[560px]:py-[10px] max-[560px]:text-[10px] max-[560px]:whitespace-nowrap"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

function ScrambleWidget() {
  const [who, setWho] = useState("What you see");
  const [val, setVal] = useState("$1,248,392 · +1.9% this month");
  const [youSide, setYouSide] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const PLAIN = "$1,248,392 · +1.9% this month";

    function morph(target: string, nextWho: string, nextYouSide: boolean) {
      if (timerRef.current) clearInterval(timerRef.current);
      let frame = 0;
      const total = 22;
      setWho(nextWho);
      setYouSide(nextYouSide);
      timerRef.current = setInterval(() => {
        frame++;
        const prog = frame / total;
        const reveal = Math.floor(target.length * prog);
        const displayed = target.slice(0, reveal) + randStr(Math.max(0, target.length - reveal));
        setVal(displayed);
        if (frame >= total) {
          setVal(target);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }, 34);
    }

    let showingPlain = true;
    const cycle = setInterval(() => {
      showingPlain = !showingPlain;
      if (showingPlain) morph(PLAIN, "What you see", true);
      else morph(`${randStr(26)}==`, "What the server sees", false);
    }, 3600);

    return () => {
      clearInterval(cycle);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div
      className="reveal-up mt-10 mx-auto border border-line rounded-[10px] flex items-center gap-[18px] justify-between px-[26px] py-[18px] max-[560px]:flex-col max-[560px]:gap-2 max-[560px]:items-start"
      style={{
        background: "rgba(235,235,230,.02)",
        animationDelay: "0.48s",
        maxWidth: 720,
      }}
    >
      <span
        className={`font-mono text-[9.5px] tracking-[0.22em] uppercase text-left flex-none w-[160px] whitespace-nowrap transition-colors duration-[400ms] ${
          youSide ? "text-accent" : "text-faint"
        }`}
      >
        {who}
      </span>
      <span
        className="font-mono tabular-nums text-cream text-right overflow-hidden whitespace-nowrap max-[560px]:text-left max-[560px]:text-[14px]"
        style={{ fontSize: "clamp(15px, 2.6vw, 22px)" }}
      >
        {val}
      </span>
    </div>
  );
}

function Hero() {
  return (
    <section
      className="relative pt-[78px] pb-[60px] text-center"
      style={{
        background:
          "radial-gradient(490px 490px at 50% 150px, rgba(127,196,198,.10), rgba(127,196,198,.03) 45%, transparent 65%)",
      }}
    >
      <div className="max-w-[1160px] mx-auto px-8">
        <p className="reveal-up font-mono text-[10.5px] tracking-[0.26em] uppercase text-accent-dim whitespace-nowrap max-[480px]:text-[9px] max-[480px]:tracking-[0.18em]">
          Open source &middot; zero&#8209;knowledge &middot; yours
        </p>
        <h1
          className="reveal-up font-serif font-normal leading-[0.98] tracking-[-0.015em] mt-6 relative"
          style={{
            fontSize: "clamp(54px, 8.6vw, 116px)",
            animationDelay: "0.1s",
          }}
        >
          Personal finance,
          <br />
          <em className="text-accent">kept personal.</em>
        </h1>
        <p
          className="reveal-up mt-[22px] mx-auto max-w-[52ch] text-[17.5px] text-dim leading-[1.65]"
          style={{ animationDelay: "0.22s" }}
        >
          Privance is a full command center for your money. Everything is encrypted in your browser
          before it leaves. The server, ours or yours, holds ciphertext and nothing else.
        </p>
        <div
          className="reveal-up flex gap-[14px] mt-[30px] justify-center flex-wrap"
          style={{ animationDelay: "0.34s" }}
        >
          <a
            href="/auth/signup/"
            className="font-mono text-[12px] tracking-[0.14em] uppercase font-medium bg-accent text-vault no-underline px-[30px] py-[17px] rounded-[7px] hover:bg-cream inline-block"
            style={{ transition: "transform .15s, background .2s" }}
          >
            Sign up
          </a>
          <a
            href="#deploy"
            className="font-mono text-[12px] tracking-[0.14em] uppercase text-cream-soft no-underline px-[26px] py-[17px] border border-line rounded-[7px] hover:border-accent-dim hover:text-accent transition-colors inline-block"
          >
            Self&#8209;host instead
          </a>
        </div>

        <ScrambleWidget />
      </div>
    </section>
  );
}

function AppFrame() {
  const [veiled, setVeiled] = useState(false);
  return (
    <section className="max-w-[1160px] mx-auto px-8 py-6 pb-[68px]">
      <div
        className="border border-line rounded-[14px] overflow-hidden"
        style={{
          background: "#121317",
          boxShadow:
            "0 50px 120px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(127,196,198,.05), 0 -1px 0 rgba(235,235,230,.06) inset",
        }}
      >
        <div
          className="flex items-center gap-2 px-[18px] py-[13px] border-b border-line-soft"
          style={{ background: "rgba(235,235,230,.015)" }}
        >
          <span className="w-[9px] h-[9px] rounded-full bg-[rgba(235,235,230,.12)]" />
          <span className="w-[9px] h-[9px] rounded-full bg-[rgba(235,235,230,.12)]" />
          <span className="w-[9px] h-[9px] rounded-full bg-[rgba(235,235,230,.12)]" />
          <span className="mx-auto font-mono text-[10.5px] text-faint tracking-[0.06em] border border-line-soft rounded-[6px] px-[14px] py-[5px] flex items-center gap-[7px]">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              className="text-accent"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            privance.app
          </span>
        </div>
        <div
          className={`p-[34px_38px_38px] max-[680px]:p-[22px_18px_24px] ${veiled ? "[&_.vfig]:blur-[8px] [&_.vfig]:opacity-50" : ""}`}
        >
          <div className="flex justify-between items-end flex-wrap gap-4">
            <div>
              <p className="font-mono text-[9.5px] tracking-[0.24em] uppercase text-faint">
                Net worth &middot; today
              </p>
              <p className="vfig font-serif text-[clamp(40px,6vw,62px)] leading-none mt-[10px] tracking-[-0.01em] transition-[filter,opacity] duration-[450ms]">
                $1,248,392
              </p>
              <p className="vfig font-mono text-[12px] text-up mt-[9px] transition-[filter,opacity] duration-[450ms]">
                &#9650; $23,847 <span className="text-faint">&middot; 1.9% &middot; 30 days</span>
              </p>
            </div>
            <button
              type="button"
              aria-pressed={veiled}
              onClick={() => setVeiled((v) => !v)}
              className={[
                "flex items-center gap-2 border rounded-full px-4 py-2 font-mono text-[10px] tracking-[0.16em] uppercase cursor-pointer transition-colors",
                veiled
                  ? "text-accent border-accent-dim bg-[rgba(127,196,198,.08)]"
                  : "text-dim border-line hover:text-accent hover:border-accent-dim",
              ].join(" ")}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
              {veiled ? "Unveil" : "Veil"}
            </button>
          </div>
          <svg
            viewBox="0 0 1000 150"
            preserveAspectRatio="none"
            className="w-full h-[150px] mt-6 block"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7FC4C6" stopOpacity=".2" />
                <stop offset="1" stopColor="#7FC4C6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,122 C70,114 120,120 190,106 C260,92 320,98 400,84 C470,72 530,78 610,62 C680,50 740,56 820,38 C880,26 940,30 1000,16 L1000,150 L0,150 Z"
              fill="url(#tg)"
            />
            <path
              className="trendline"
              d="M0,122 C70,114 120,120 190,106 C260,92 320,98 400,84 C470,72 530,78 610,62 C680,50 740,56 820,38 C880,26 940,30 1000,16"
              fill="none"
              stroke="#7FC4C6"
              strokeWidth="2"
            />
            <circle cx="1000" cy="16" r="4" fill="#7FC4C6" />
          </svg>
          <div className="grid gap-[30px] mt-2 grid-cols-[1.2fr_.8fr] max-[680px]:grid-cols-1">
            <div>
              {[
                ["VTI", "Vanguard Total Market", "$412,288"],
                ["AAPL", "Apple", "$188,114"],
                ["BTC", "Bitcoin", "$96,402"],
                ["NVDA", "NVIDIA", "$81,719"],
              ].map(([tk, nm, v]) => (
                <div
                  key={tk}
                  className="flex justify-between items-baseline py-3 border-b border-line-soft last:border-b-0"
                >
                  <span className="font-mono text-[11.5px] text-accent tracking-[0.06em] w-[52px] flex-none">
                    {tk}
                  </span>
                  <span className="flex-1 text-[13px] text-cream-soft text-left">{nm}</span>
                  <span className="vfig font-mono text-[12.5px] transition-[filter,opacity] duration-[450ms]">
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <p className="font-mono text-[9.5px] tracking-[0.24em] uppercase text-faint mt-3">
                Allocation
              </p>
              <div className="flex h-[7px] rounded-full overflow-hidden mt-[14px]">
                <span style={{ width: "60%", background: "#7FC4C6" }} />
                <span style={{ width: "20%", background: "#4F898C" }} />
                <span style={{ width: "10%", background: "#C8551F" }} />
                <span style={{ flex: 1, background: "rgba(235,235,230,.2)" }} />
              </div>
              <div className="flex gap-[18px] mt-3 flex-wrap">
                {[
                  ["#7FC4C6", "Equities 60"],
                  ["#4F898C", "Bonds 20"],
                  ["#C8551F", "Crypto 10"],
                  ["rgba(235,235,230,.4)", "Cash 10"],
                ].map(([color, label]) => (
                  <span
                    key={label}
                    className="font-mono text-[9.5px] tracking-[0.1em] uppercase text-faint flex gap-[7px] items-center"
                  >
                    <span className="w-2 h-2 rounded-[2px]" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
              <p className="font-mono text-[9.5px] tracking-[0.24em] uppercase text-faint mt-[26px]">
                Plan
              </p>
              <p className="font-serif text-[19px] mt-2">
                Independent by <em className="text-accent">2041</em>
              </p>
              <p className="font-mono text-[10.5px] text-faint mt-[5px]">
                84% of 1,000 simulated futures
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-[18px] font-mono text-[9.5px] tracking-[0.16em] uppercase text-faint flex-wrap gap-2">
        <span className={`text-accent transition-opacity ${veiled ? "opacity-0" : ""}`}>
          &#9650; tap the veil, numbers off, shape on
        </span>
      </div>
    </section>
  );
}

function CipherBelt() {
  const chunks: string[] = [];
  for (let i = 0; i < 6; i++) {
    let chunk = "";
    for (let j = 0; j < 56; j++) chunk += GLYPHS[(i * 56 + j * 7 + 3) % GLYPHS.length];
    chunks.push(`${chunk}==`);
  }
  // Doubled so the marquee can scroll -50% seamlessly.
  const doubled = [...chunks, ...chunks];

  return (
    <div
      aria-hidden="true"
      className="border-t border-b border-line-soft overflow-hidden py-[15px] relative"
      style={{ background: "#121317" }}
    >
      <span
        className="absolute left-0 top-0 bottom-0 z-[2] flex items-center font-mono text-[10px] tracking-[0.22em] uppercase text-accent"
        style={{
          padding: "0 22px 0 32px",
          background: "linear-gradient(to right, #121317 72%, transparent)",
        }}
      >
        What our servers see
      </span>
      <div className="belt-marquee flex w-max">
        {doubled.map((chunk, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static decorative marquee, never reordered
            key={i}
            className="font-mono text-[12px] text-faint whitespace-nowrap pr-12"
          >
            {chunk}
          </span>
        ))}
      </div>
      <style>{`@keyframes belt{to{transform:translateX(-50%)}}.belt-marquee{animation:belt 38s linear infinite}@media(prefers-reduced-motion:reduce){.belt-marquee{animation:none}}`}</style>
    </div>
  );
}

function Tenets() {
  const items = [
    {
      idx: "i.",
      seal: "SEALED",
      title: "Encrypted",
      titleEm: "before",
      titleSuffix: "it leaves",
      body: "Argon2id stretches your master password in the browser. Keys never travel. Every record is sealed on your device and only ever opens there.",
    },
    {
      idx: "ii.",
      seal: "YOURS",
      title: "Yours,",
      titleEm: "either way",
      titleSuffix: "",
      body: "Use privance.app, where we store ciphertext we cannot read, or run it yourself with one container. Same protocol, same blindness.",
    },
    {
      idx: "iii.",
      seal: "HONEST",
      title: "No backdoor,",
      titleEm: "by design.",
      titleSuffix: "",
      body: "No resets, no recovery email, no master key in a drawer. Lose your password and your phrase and the data is gone. We can't undo that, and we won't pretend otherwise.",
    },
  ];

  return (
    <section id="tenets" className="py-12">
      <div className="max-w-[1160px] mx-auto px-8">
        <div className="mb-9">
          <p className="font-mono text-[10.5px] tracking-[0.26em] uppercase text-accent-dim">
            Three tenets
          </p>
          <h2
            className="font-serif font-normal leading-[1.03] tracking-[-0.015em] mt-[14px] max-w-[20ch]"
            style={{ fontSize: "clamp(36px, 5vw, 60px)" }}
          >
            Privacy isn&rsquo;t a setting here.{" "}
            <em className="text-accent">It&rsquo;s the architecture.</em>
          </h2>
        </div>
        <div className="grid gap-4 grid-cols-[repeat(3,1fr)] max-[880px]:grid-cols-1">
          {items.map((t) => (
            <div
              key={t.idx}
              className="border border-line rounded-[12px] px-[30px] py-[34px] bg-panel relative group transition-[transform,border-color] duration-[250ms] hover:-translate-y-1 hover:border-[rgba(127,196,198,.35)]"
            >
              <span className="absolute top-5 right-[22px] font-serif italic text-[18px] text-faint">
                {t.idx}
              </span>
              <div
                className="w-[52px] h-[52px] border border-accent-dim rounded-full flex items-center justify-center text-accent font-mono text-[7.5px] tracking-[0.12em] relative mb-[26px]"
                style={{ transform: "rotate(-8deg)" }}
              >
                <span className="absolute inset-[4px] border border-dashed border-[rgba(127,196,198,.35)] rounded-full" />
                {t.seal}
              </div>
              <h3 className="font-serif font-normal text-[26px] tracking-[-0.01em] leading-[1.12]">
                {t.title} <em className="text-accent">{t.titleEm}</em> {t.titleSuffix}
              </h3>
              <p className="mt-3 text-[14px] text-dim max-w-[36ch] leading-[1.6]">{t.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Protocol() {
  return (
    <section id="protocol" className="py-12 border-t border-line-soft relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute pointer-events-none w-[760px] h-[760px] rounded-full right-[-300px] top-[-200px]"
        style={{ background: "radial-gradient(circle, rgba(127,196,198,.07), transparent 62%)" }}
      />
      <div className="max-w-[1160px] mx-auto px-8 grid gap-12 items-start grid-cols-[.9fr_1.1fr] max-[920px]:grid-cols-1 max-[920px]:gap-11">
        <div>
          <p className="font-mono text-[10.5px] tracking-[0.26em] uppercase text-accent-dim">
            The protocol
          </p>
          <h2
            className="font-serif font-normal leading-[1.05] tracking-[-0.015em] mt-[14px]"
            style={{ fontSize: "clamp(34px, 4.6vw, 54px)" }}
          >
            Built so we <em className="text-accent">couldn&rsquo;t peek</em> even if subpoenaed.
          </h2>
          <p className="mt-[18px] text-dim text-[15px] max-w-[40ch] leading-[1.65]">
            Not a privacy policy. A key schedule. The math is public, the code is open, and the
            server&rsquo;s ignorance is provable from both.
          </p>
          <div className="mt-[34px]">
            <code
              className="block font-mono text-[12.5px] text-accent border border-[rgba(127,196,198,.2)] rounded-[8px] px-[18px] py-[13px]"
              style={{ background: "rgba(127,196,198,.06)" }}
            >
              github.com/rahulkrishnan1/privance
            </code>
            <span className="block mt-[10px] font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
              audit it, fork it, run it
            </span>
          </div>
        </div>
        <div className="relative">
          {[
            {
              n: "i.",
              title: "Stretch",
              body: "Your master password runs through Argon2id, memory hard and GPU hostile, entirely in the browser.",
            },
            {
              n: "ii.",
              title: "Split",
              body: "HKDF derives two independent keys: one to authenticate, one to encrypt. The server only ever meets the first.",
            },
            {
              n: "iii.",
              title: "Seal",
              body: "AES‑256‑GCM seals every record, bound to its identity so nothing can be swapped, replayed, or downgraded.",
            },
          ].map((step, i, arr) => (
            <div
              key={step.n}
              className="flex gap-5 px-6 py-[22px] border border-line rounded-[11px] bg-panel relative mb-[14px]"
            >
              {i < arr.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute left-10 bottom-[-15px] w-px h-[15px] bg-accent-dim opacity-50"
                />
              )}
              <span className="font-serif italic text-[26px] text-accent flex-none w-[34px] opacity-90">
                {step.n}
              </span>
              <div>
                <h4 className="font-mono text-[11.5px] tracking-[0.18em] uppercase text-cream">
                  {step.title}
                </h4>
                <p className="mt-[7px] text-[13.5px] text-dim leading-[1.6]">{step.body}</p>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-[14px] mt-[22px] max-[560px]:grid-cols-1">
            <div className="rounded-[11px] px-[22px] py-5 border border-[rgba(127,196,198,.3)] bg-[rgba(127,196,198,.05)]">
              <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-accent">
                Server holds
              </span>
              <p className="font-mono text-[12.5px] mt-[9px] text-cream-soft leading-[1.7]">
                auth verifier
                <br />
                ciphertext blobs
                <br />
                timestamps
              </p>
            </div>
            <div className="rounded-[11px] px-[22px] py-5 border border-line">
              <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-faint">
                Server never holds
              </span>
              <p className="font-mono text-[12.5px] mt-[9px] text-cream-soft leading-[1.7]">
                <s className="text-faint no-underline line-through">passwords</s>
                <br />
                <s className="text-faint no-underline line-through">encryption keys</s>
                <br />
                <s className="text-faint no-underline line-through">a single balance</s>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Deploy() {
  return (
    <section id="deploy" className="py-12 border-t border-line-soft">
      <div className="max-w-[1160px] mx-auto px-8">
        <div className="mb-9">
          <p className="font-mono text-[10.5px] tracking-[0.26em] uppercase text-accent-dim">
            Two ways in
          </p>
          <h2
            className="font-serif font-normal leading-[1.03] tracking-[-0.015em] mt-[14px] max-w-[20ch]"
            style={{ fontSize: "clamp(36px, 5vw, 60px)" }}
          >
            Run it on our box, <em className="text-accent">or your own.</em>
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-4 max-[880px]:grid-cols-1">
          <div className="border border-line rounded-[12px] px-[30px] py-[30px] bg-panel relative">
            <span className="absolute top-5 right-[22px] font-mono text-[14px] tracking-[0.18em] text-accent">
              RECOMMENDED
            </span>
            <h3 className="font-serif font-normal text-[26px] tracking-[-0.01em] mt-[26px]">
              privance.app
            </h3>
            <p className="mt-3 text-[14px] text-dim max-w-[44ch] leading-[1.6]">
              Sign up and go. We run the servers and keep the backups, and all we ever hold is
              ciphertext. Zero knowledge means trusting the math, not us.
            </p>
            <a
              href="/auth/signup/"
              className="font-mono text-[12px] tracking-[0.14em] uppercase font-medium bg-accent text-vault no-underline px-[30px] py-[17px] rounded-[7px] hover:bg-cream transition-colors inline-block mt-[26px]"
            >
              Create your vault
            </a>
          </div>
          <div className="border border-line rounded-[12px] px-[30px] py-[30px] bg-panel relative">
            <span className="absolute top-5 right-[22px] font-mono text-[14px] tracking-[0.18em] text-faint">
              FULL CONTROL
            </span>
            <h3 className="font-serif font-normal text-[26px] tracking-[-0.01em] mt-[26px]">
              Your own box
            </h3>
            <p className="mt-3 text-[14px] text-dim max-w-[44ch] leading-[1.6]">
              One container, one Postgres. A Raspberry Pi will do. Bring a domain and you own the
              whole data path, end to end.
            </p>
            <code
              className="block font-mono text-[12.5px] text-accent border border-[rgba(127,196,198,.2)] rounded-[8px] px-[18px] py-[13px] mt-[26px]"
              style={{ background: "rgba(127,196,198,.06)" }}
            >
              $ docker compose up -d
            </code>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="py-12 border-t border-line-soft">
      <div className="max-w-[1160px] mx-auto px-8">
        <div className="mb-9">
          <p className="font-mono text-[10.5px] tracking-[0.26em] uppercase text-accent-dim">
            Inside the vault
          </p>
          <h2
            className="font-serif font-normal leading-[1.03] tracking-[-0.015em] mt-[14px] max-w-[24ch]"
            style={{ fontSize: "clamp(36px, 5vw, 60px)" }}
          >
            What you own, what it earns, <em className="text-accent">where it&rsquo;s headed.</em>
          </h2>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
          {[
            {
              cls: "col-span-4 max-[880px]:col-span-6",
              tag: "Net worth",
              title: "One number, honestly computed",
              body: "Assets minus liabilities across every account, with a scrubbable trend. Exact decimal math, never floating point.",
              art: (
                <svg viewBox="0 0 520 84" aria-hidden="true" className="w-full">
                  <path
                    d="M0,70 C60,62 90,68 140,54 C190,40 230,48 280,34 C330,24 370,30 420,16 C460,8 490,12 520,4"
                    fill="none"
                    stroke="#7FC4C6"
                    strokeWidth="2"
                  />
                  <path
                    d="M0,70 C60,62 90,68 140,54 C190,40 230,48 280,34 C330,24 370,30 420,16 C460,8 490,12 520,4 L520,84 L0,84 Z"
                    fill="#7FC4C6"
                    opacity=".07"
                  />
                </svg>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "The veil",
              title: "Numbers off, shape on",
              body: "One tap frosts every figure for shoulder surfers. Charts and weights stay readable.",
              art: (
                <div className="font-mono text-[19px] tracking-[0.14em] text-accent">
                  $ &bull;&bull;&bull;,&bull;&bull;&bull;
                </div>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Insights",
              title: "Allocation, sectors, concentration",
              body: "By class, by sector, by single‑name weight, plus where every dollar lives by tax. Catch concentration before it bites.",
              art: (
                <svg viewBox="0 0 200 36" aria-hidden="true" className="w-full">
                  <rect x="0" y="14" width="200" height="8" rx="4" fill="rgba(235,235,230,.08)" />
                  <rect x="0" y="14" width="118" height="8" rx="4" fill="#7FC4C6" />
                  <rect x="118" y="14" width="42" height="8" fill="#4F898C" />
                  <rect x="160" y="14" width="20" height="8" fill="#C8551F" />
                </svg>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Spending",
              title: "What you're committed to",
              body: "Rent, utilities, insurance, subscriptions, logged by hand. No bank linking; the server never learns where the money went.",
              art: (
                <div className="font-mono text-[11.5px] text-faint tracking-[0.06em]">
                  12 recurring &middot; $2,140 / mo
                </div>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Plan",
              title: "Independence, simulated",
              body: "Monte Carlo and historical replay run in a worker on your machine. Retirement math that never phones home.",
              art: (
                <svg viewBox="0 0 200 56" aria-hidden="true" className="w-full">
                  <path d="M0,50 C50,44 90,32 200,2 L200,56 L0,56 Z" fill="#7FC4C6" opacity=".08" />
                  <path
                    d="M0,50 C50,46 90,38 200,16 L200,56 L0,56 Z"
                    fill="#7FC4C6"
                    opacity=".12"
                  />
                  <path
                    d="M0,50 C50,47 100,42 200,30"
                    fill="none"
                    stroke="#7FC4C6"
                    strokeWidth="1.8"
                  />
                  <circle cx="146" cy="37" r="3.2" fill="#C8551F" />
                </svg>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Holdings",
              title: "Priced live, owned quietly",
              body: "Stocks, funds, and crypto with fractional shares and your real cost basis. Price lookups go out anonymously, never tied to you.",
              art: (
                <div className="font-mono text-[11.5px] text-faint tracking-[0.06em]">
                  VTI &middot; 1,482.214 sh &middot; <span className="text-up">+30.5%</span>
                </div>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Unlock",
              title: "Face, fingerprint, phrase",
              body: "Biometric unlock via passkeys on devices you trust. The recovery phrase stays on paper, where it belongs.",
              art: (
                <div className="font-mono text-[11.5px] text-faint tracking-[0.06em]">
                  salt &middot; ember &middot; quiet &middot; harbor &middot; &hellip;
                </div>
              ),
            },
            {
              cls: "col-span-2 max-[880px]:col-span-6",
              tag: "Everywhere",
              title: "Installs from the browser",
              body: "A progressive web app that works offline on desktop and phone. No app store between you and your money.",
              art: (
                <svg viewBox="0 0 200 44" aria-hidden="true" className="w-full">
                  <rect
                    x="0"
                    y="2"
                    width="96"
                    height="40"
                    rx="4"
                    fill="none"
                    stroke="#4F898C"
                    strokeWidth="1.5"
                  />
                  <rect
                    x="172"
                    y="0"
                    width="24"
                    height="44"
                    rx="5"
                    fill="none"
                    stroke="#7FC4C6"
                    strokeWidth="1.5"
                  />
                  <line
                    x1="106"
                    y1="22"
                    x2="162"
                    y2="22"
                    stroke="#C8551F"
                    strokeWidth="1.5"
                    strokeDasharray="3 4"
                  />
                </svg>
              ),
            },
          ].map((f) => (
            <div
              key={f.tag}
              className={`${f.cls} border border-line rounded-[12px] p-[30px] bg-panel relative overflow-hidden transition-[transform,border-color] duration-[250ms] hover:-translate-y-1 hover:border-[rgba(127,196,198,.3)]`}
            >
              <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-accent">
                {f.tag}
              </span>
              <h3 className="font-serif font-normal text-[24px] mt-[10px] tracking-[-0.01em]">
                {f.title}
              </h3>
              <p className="mt-[10px] text-[13.5px] text-dim max-w-[46ch] leading-[1.6]">
                {f.body}
              </p>
              <div className="mt-6">{f.art}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="pt-20 pb-11 border-t border-line-soft relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          bottom: "-420px",
          transform: "translateX(-50%)",
          width: 900,
          height: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(127,196,198,.08), transparent 60%)",
        }}
      />
      <div className="max-w-[1160px] mx-auto px-8 relative">
        <p
          className="font-serif font-normal tracking-[-0.02em] leading-[0.96] text-center"
          style={{ fontSize: "clamp(52px, 9vw, 118px)" }}
        >
          Keep it <em className="text-accent">private.</em>
        </p>
        <div className="flex justify-center mt-7">
          <a
            href="/auth/signup/"
            className="font-mono text-[12px] tracking-[0.14em] uppercase font-medium bg-accent text-vault no-underline px-[30px] py-[17px] rounded-[7px] hover:bg-cream transition-colors inline-block"
          >
            Start with Privance
          </a>
        </div>
        <div className="flex justify-between items-center gap-7 flex-wrap mt-[52px] pt-6 border-t border-line-soft">
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
            Privance &middot; zero&#8209;knowledge personal finance
          </span>
          <div className="flex gap-[26px] flex-wrap">
            {[
              { label: "Self‑host guide", href: "#deploy" },
              { label: "Protocol", href: "#protocol" },
              {
                label: "Threat model",
                href: "https://github.com/rahulkrishnan1/privance/blob/main/THREAT_MODEL.md",
              },
              { label: "Source", href: "https://github.com/rahulkrishnan1/privance" },
            ].map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-dim hover:text-accent transition-colors no-underline"
              >
                {l.label}
              </a>
            ))}
          </div>
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
            No analytics. No trackers. This page can&rsquo;t even tell anyone you read it.
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const { state } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  useIsoLayoutEffect(() => {
    if (!mounted) return;
    if (state === "unlocked") window.location.replace("/app/");
    else if (state === "locked") window.location.replace("/unlock/");
  }, [mounted, state]);

  if (!(mounted && state === "unauthenticated")) return null;

  return (
    <>
      <NavBar />
      <main className="relative">
        <Hero />
        <AppFrame />
        <CipherBelt />
        <Tenets />
        <Protocol />
        <Deploy />
        <Features />
        <LandingFooter />
      </main>
    </>
  );
}
