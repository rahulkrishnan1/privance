"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/index";
import { useAuth } from "@/providers/auth-context";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Protocol", href: "#protocol" },
  { label: "Tenets", href: "#tenets" },
  { label: "Threat model", href: "#threats" },
  { label: "FAQ", href: "#faq" },
];

const FEATURES = [
  {
    n: "01",
    tag: "live",
    title: "Accounts",
    body: "Bank, brokerage, retirement, manual. Add and update them on your device; only ciphertext leaves your browser.",
    visual: (
      <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
        <rect
          x="14"
          y="8"
          width="84"
          height="18"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.35"
        />
        <rect
          x="22"
          y="30"
          width="84"
          height="18"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          opacity="0.6"
        />
        <rect
          x="30"
          y="52"
          width="84"
          height="18"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    ),
  },
  {
    n: "02",
    tag: "live",
    title: "Holdings",
    body: "Every security and crypto position with cost basis. Decrypted only on your device, never on the wire.",
    visual: (
      <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
        <line
          x1="6"
          y1="74"
          x2="114"
          y2="74"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.25"
        />
        <rect x="14" y="46" width="14" height="28" fill="currentColor" opacity="0.35" />
        <rect x="34" y="30" width="14" height="44" fill="currentColor" opacity="0.55" />
        <rect x="54" y="18" width="14" height="56" fill="currentColor" opacity="0.75" />
        <rect x="74" y="38" width="14" height="36" fill="currentColor" opacity="0.5" />
        <rect x="94" y="24" width="14" height="50" fill="currentColor" />
      </svg>
    ),
  },
  {
    n: "03",
    tag: "live",
    title: "Dashboard",
    body: "Net worth and composition at a glance, computed locally from your encrypted records.",
    visual: (
      <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
        <line
          x1="6"
          y1="74"
          x2="114"
          y2="74"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.25"
        />
        <polyline
          points="10,62 28,52 46,56 64,38 82,42 100,22 114,12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="114" cy="12" r="3" fill="currentColor" />
      </svg>
    ),
  },
];

const TENETS = [
  {
    n: "01",
    title: "Zero-knowledge",
    body: "Every record is sealed with AES-256-GCM in your browser before it touches the network. The server stores ciphertext and an audit log. No plaintext. No master key. No escape hatch.",
    chip: "AES-256-GCM · per-record AAD",
  },
  {
    n: "02",
    title: "Self-hostable",
    body: "One compose file. Bring your own VPS, an old laptop, a Raspberry Pi. The hosted instance at privance.app runs the same image you would. No vendor lock-in by construction.",
    chip: "Bun · Hono · Postgres 17",
  },
  {
    n: "03",
    title: "Open source",
    body: "Every line of client, server, and crypto is auditable. Dependencies are exact-pinned, never carets, never tildes. No telemetry, no analytics, no funnels. AGPL-3.0 licensed.",
    chip: "AGPL-3.0 · pinned · zero telemetry",
  },
  {
    n: "04",
    title: "No bank linking",
    body: "We do not integrate with Plaid, MX, or any aggregator. Connecting them would mean a third party reads your transactions in plaintext. That breaks the model. Manual entry and CSV keep the guarantee honest.",
    chip: "manual entry · CSV import (soon)",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Choose a master password",
    body: "We stretch it with Argon2id and derive your key encryption key locally. You write down a BIP39 recovery phrase, once. That phrase plus your password is the only thing standing between you and your data.",
    chip: "Argon2id · BIP39",
  },
  {
    n: "02",
    title: "Encrypt on your device",
    body: "Every record is sealed with AES-256-GCM in your browser, bound to a per-record AAD that prevents record swapping, downgrade attacks, and cross-kind confusion. The key never leaves memory.",
    chip: "AES-256-GCM · HKDF",
  },
  {
    n: "03",
    title: "Sync to a server you trust",
    body: "Encrypted blobs sync to the Postgres you own. Open Privance on another device, unlock with the same password, and your data decrypts locally. Lose the device, your data is unaffected. Lose the password and recovery phrase, it is gone, by design.",
    chip: "Postgres 17 · idempotent sync",
  },
];

const FAQS = [
  {
    q: "What if I forget my master password?",
    a: "Use your recovery phrase to set a new one. If you lose both, your data is unrecoverable. We cannot reset it because we do not have it. That is what zero-knowledge means.",
  },
  {
    q: "Can the operator see my balances?",
    a: "No. The server stores ciphertext bound to a per-record AAD. Encryption and decryption happen in your browser, against a key derived from your password. Compromise the database and an attacker walks away with opaque bytes.",
  },
  {
    q: "Why no bank linking?",
    a: "Aggregators have to see your data. That is their job. Connecting them would mean a third party reads your transactions in plaintext, breaking the privacy guarantee. Manual entry keeps the model honest.",
  },
  {
    q: "Self-host or hosted?",
    a: "Both. The hosted instance at privance.app is a deployment of the same Docker image you would run. Hosted is invite-only during beta; self-host is unrestricted.",
  },
  {
    q: "Can I install it on my phone?",
    a: 'Yes. Privance is a Progressive Web App. Open it in Safari, Chrome, or Edge and use "Add to Home Screen" to install it like a native app. Same SQLite-on-device store, same encryption everywhere.',
  },
  {
    q: "What if Privance shuts down?",
    a: "You can move. Self-host the whole product as a single Docker compose file. Your data lives on devices and a Postgres you own. The hosted instance going down has no bearing on a self-hosted one.",
  },
];

function NavBar({ scrolled }: { scrolled: boolean }) {
  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-stone-950/70 backdrop-blur-xl border-b border-stone-900/80"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo size={26} className="text-gold-accent" />
          <span
            className="fraunces text-lg tracking-tight text-stone-100 group-hover:text-white transition-colors"
            style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
          >
            Privance
          </span>
        </Link>

        <nav
          aria-label="Sections"
          className="hidden md:flex items-center gap-9 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-400"
        >
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-stone-100 transition-colors">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3 md:gap-5">
          <Link
            href="/auth/login"
            className="hidden md:inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-stone-400 hover:text-stone-100 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 bg-stone-100 text-stone-950 hover:bg-white px-4 py-2 text-[13px] font-medium rounded-full transition-colors"
          >
            Get an invite
          </Link>
        </div>
      </div>
    </header>
  );
}

function SectionLabel({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-stone-500">
      <span className="text-gold-accent">§ {n}</span>
      <span className="h-px w-12 bg-stone-700" />
      <span>{label}</span>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative px-6 md:px-10 pt-20 pb-16 md:pt-28 md:pb-24 max-w-7xl mx-auto">
      <div className="reveal-fade">
        <SectionLabel n="001" label="Privance · personal finance, encrypted" />
      </div>

      <h1 className="mt-10 fraunces-display text-[clamp(2.75rem,9vw,8rem)] leading-[0.95] tracking-[-0.025em] text-stone-50 font-light">
        <span className="block reveal-up" style={{ animationDelay: "0.05s" }}>
          Track your wealth.
        </span>
        <span className="block reveal-up" style={{ animationDelay: "0.18s" }}>
          <span className="fraunces-italic text-gold-accent">Privately.</span>
        </span>
      </h1>

      <p
        className="mt-10 max-w-xl text-lg md:text-xl leading-relaxed text-stone-400 reveal-up"
        style={{ animationDelay: "0.5s" }}
      >
        A self-hostable personal finance app that runs on your server and keeps your data unreadable
        to anyone but you. Open source. Zero-knowledge encryption. Yours.
      </p>

      <div
        className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-4 reveal-up"
        style={{ animationDelay: "0.65s" }}
      >
        <Link
          href="/auth/signup"
          className="group relative inline-flex items-center gap-3 bg-gold-accent hover:bg-gold-accent-hover text-stone-950 px-7 py-3.5 text-sm font-medium tracking-wide rounded-full transition-colors"
        >
          Request an invite
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>
        <a
          href="#protocol"
          className="group inline-flex items-center gap-2.5 text-stone-300 hover:text-stone-100 px-2 py-3 text-sm font-medium tracking-wide transition-colors"
        >
          Read the protocol
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </a>
      </div>

      <div
        className="mt-16 pt-8 border-t border-stone-900 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[10px] uppercase tracking-[0.22em] text-stone-500 reveal-fade"
        style={{ animationDelay: "0.9s" }}
      >
        <span>AES-256-GCM</span>
        <span className="text-stone-700">/</span>
        <span>Argon2id</span>
        <span className="text-stone-700">/</span>
        <span>BIP39 recovery</span>
        <span className="text-stone-700">/</span>
        <span>AGPL-3.0 licensed</span>
        <span className="text-stone-700">/</span>
        <span className="text-gold-accent">invite-only beta</span>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      id="features"
      className="relative px-6 md:px-10 py-20 md:py-28 border-t border-stone-900/70"
    >
      <div className="max-w-7xl mx-auto">
        <SectionLabel n="002" label="Features" />

        <h2 className="mt-10 fraunces text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-[-0.025em] text-stone-50 font-light max-w-3xl">
          Available now. <span className="fraunces-italic text-stone-300">More on the way.</span>
        </h2>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-900/80 border border-stone-900/80">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-stone-950 p-8 md:p-10">
              <div className="flex items-center justify-between gap-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold-accent">
                  {f.n}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">
                  {f.tag}
                </div>
              </div>

              <div className="mt-8 h-28 flex items-end justify-center text-gold-accent">
                {f.visual}
              </div>

              <h3
                className="mt-8 fraunces text-2xl md:text-3xl tracking-[-0.015em] text-stone-50 font-light"
                style={{ fontVariationSettings: '"opsz" 32, "SOFT" 50' }}
              >
                {f.title}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Protocol() {
  return (
    <section
      id="protocol"
      className="relative px-6 md:px-10 py-20 md:py-28 border-t border-stone-900/70"
    >
      <div className="max-w-7xl mx-auto">
        <SectionLabel n="003" label="Protocol" />

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-20 items-end">
          <h2 className="fraunces text-[clamp(2rem,5.5vw,4.5rem)] leading-[1.03] tracking-[-0.025em] text-stone-50 font-light">
            What <span className="fraunces-italic text-gold-accent">zero-knowledge</span> actually
            means.
          </h2>
          <p className="text-stone-400 leading-relaxed text-base md:text-lg max-w-md">
            The server learns nothing about the contents of your finances, because it cannot. Three
            well-studied primitives keep it that way.
          </p>
        </div>

        {/* Architectural diagram */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-0 items-stretch">
          {/* Device side */}
          <div className="relative border border-stone-800 bg-stone-900/30 backdrop-blur-sm p-8 md:p-10 md:border-r-0">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-gold-accent">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-accent" />
              on your device
            </div>

            <div className="mt-10 space-y-1.5">
              <div className="font-mono text-sm text-stone-200">master password</div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">↓ argon2id</div>
              <div className="inline-flex border border-stone-700 px-4 py-2 font-mono text-sm text-stone-200 bg-stone-950/40">
                KEK
              </div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">↓ unwraps</div>
              <div className="inline-flex border border-gold-accent/50 bg-gold-accent/[0.06] px-4 py-2 font-mono text-sm text-gold-accent">
                DEK
              </div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">↓ aes-256-gcm</div>
              <div className="inline-flex border border-stone-700 px-4 py-2 font-mono text-sm text-stone-200 bg-stone-950/40">
                ciphertext
              </div>
            </div>

            <div className="mt-10 pt-6 border-t border-stone-800/80 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 leading-relaxed">
              in-memory only
              <br />
              cleared on lock or tab close
            </div>
          </div>

          {/* Bridge */}
          <div className="relative flex md:flex-col items-center justify-center px-6 py-6 md:py-0 md:px-10 border-t border-b md:border-y-0 md:border-l md:border-r border-stone-800 bg-stone-950/60">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-500 whitespace-nowrap">
              over TLS
            </div>
            <div
              aria-hidden="true"
              className="mx-4 md:mx-0 md:my-4 h-px w-16 md:h-32 md:w-px bg-gradient-to-r md:bg-gradient-to-b from-transparent via-gold-accent/60 to-transparent"
            />
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-500 whitespace-nowrap">
              → bytes →
            </div>
          </div>

          {/* Server side */}
          <div className="relative border border-stone-800 bg-stone-900/30 backdrop-blur-sm p-8 md:p-10 md:border-l-0">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-stone-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone-500" />
              on your server
            </div>

            <div className="mt-10 space-y-1.5">
              <div className="inline-flex border border-stone-700 px-4 py-2 font-mono text-sm text-stone-200 bg-stone-950/40">
                ciphertext (bytes)
              </div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">↓ stored as-is</div>
              <div className="inline-flex border border-stone-700 px-4 py-2 font-mono text-sm text-stone-200 bg-stone-950/40">
                Postgres 17
              </div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">+</div>
              <div className="inline-flex border border-stone-700 px-4 py-2 font-mono text-sm text-stone-200 bg-stone-950/40">
                audit log
              </div>
              <div className="font-mono text-[11px] text-stone-500 pl-4 py-1">+</div>
              <div className="inline-flex border border-stone-800 px-4 py-2 font-mono text-sm text-stone-500 bg-stone-950/40 line-through decoration-stone-700">
                plaintext
              </div>
            </div>

            <div className="mt-10 pt-6 border-t border-stone-800/80 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 leading-relaxed">
              no plaintext, ever
              <br />
              no recovery escape hatch
            </div>
          </div>
        </div>

        {/* Three steps, inlined below the diagram */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-12">
          {STEPS.map((s) => (
            <div key={s.n} className="space-y-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-accent">
                step / {s.n}
              </div>
              <h3
                className="fraunces text-xl md:text-2xl tracking-[-0.015em] text-stone-50 font-light leading-tight"
                style={{ fontVariationSettings: '"opsz" 32, "SOFT" 50' }}
              >
                {s.title}
              </h3>
              <p className="text-sm leading-relaxed text-stone-400">{s.body}</p>
              <div className="inline-flex font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 border border-stone-800 px-3 py-1.5 rounded-full">
                {s.chip}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tenets() {
  return (
    <section
      id="tenets"
      className="relative px-6 md:px-10 py-20 md:py-28 border-t border-stone-900/70"
    >
      <div className="max-w-7xl mx-auto">
        <SectionLabel n="004" label="Tenets" />

        <h2 className="mt-10 fraunces text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-[-0.025em] text-stone-50 font-light max-w-3xl">
          Four <span className="fraunces-italic text-stone-300">non-negotiables.</span>
        </h2>

        <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-px bg-stone-900/80 border border-stone-900/80">
          {TENETS.map((t) => (
            <div
              key={t.n}
              className="group relative bg-stone-950 p-8 md:p-12 transition-colors hover:bg-stone-900/40"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold-accent">
                  {t.n}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 text-right">
                  {t.chip}
                </div>
              </div>

              <h3
                className="mt-10 fraunces text-3xl md:text-4xl tracking-[-0.015em] text-stone-50 font-light"
                style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
              >
                {t.title}
              </h3>

              <p className="mt-5 text-base leading-relaxed text-stone-400 max-w-md">{t.body}</p>

              <div
                aria-hidden="true"
                className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-accent/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ThreatModel() {
  return (
    <section
      id="threats"
      className="relative px-6 md:px-10 py-20 md:py-28 border-t border-stone-900/70 bg-gradient-to-b from-transparent via-gold-950/10 to-transparent"
    >
      <div className="max-w-7xl mx-auto">
        <SectionLabel n="005" label="Threat model" />

        <h2 className="mt-10 fraunces text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-[-0.025em] text-stone-50 font-light max-w-3xl">
          What we protect <span className="fraunces-italic text-stone-300">against</span>, and what
          we don&rsquo;t.
        </h2>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
          <div className="relative border border-stone-800 bg-stone-900/30 p-8 md:p-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-accent">
              we protect against
            </div>
            <ul className="mt-8 space-y-4 text-stone-300">
              {[
                "Server compromise. Database dumps yield ciphertext, not balances.",
                "Subpoena of the operator. We cannot decrypt what we do not hold the key to.",
                "Insider access. No staff key, no master, no backdoor.",
                "Record tampering. Per-record AAD detects substitution.",
                "Key versioning attacks. Parameter versions bind into the AAD.",
              ].map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="text-gold-accent font-mono mt-1 text-xs">+</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative border border-stone-800/60 bg-stone-900/10 p-8 md:p-10">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stone-400">
              we don&rsquo;t protect against
            </div>
            <ul className="mt-8 space-y-4 text-stone-400">
              {[
                "A compromised device. If your machine is keylogged, your password is gone.",
                "A weak master password. Use the recovery phrase as the strong backup.",
                "Losing both password and phrase. There is no recovery. Yes, really.",
                "Traffic-pattern analysis at scale. We minimise but cannot eliminate metadata.",
                "Bugs in the cryptographic libraries we audit and pin.",
              ].map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="text-stone-500 font-mono mt-1 text-xs">−</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section
      id="faq"
      className="relative px-6 md:px-10 py-20 md:py-28 border-t border-stone-900/70"
    >
      <div className="max-w-7xl mx-auto">
        <SectionLabel n="006" label="FAQ" />

        <h2 className="mt-10 fraunces text-[clamp(2rem,5vw,4rem)] leading-[1.05] tracking-[-0.025em] text-stone-50 font-light max-w-3xl">
          The <span className="fraunces-italic text-stone-300">honest</span> answers.
        </h2>

        <dl className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-14">
          {FAQS.map((f) => (
            <div key={f.q} className="group">
              <dt
                className="fraunces text-xl md:text-2xl text-stone-100 leading-snug"
                style={{ fontVariationSettings: '"opsz" 32, "SOFT" 50' }}
              >
                {f.q}
              </dt>
              <dd className="mt-4 text-stone-400 leading-relaxed text-[15px]">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative px-6 md:px-10 pt-20 md:pt-28 pb-12 border-t border-stone-900/70">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-16 md:gap-24 items-end">
          <div>
            <h2 className="fraunces-display text-[clamp(2.5rem,8vw,7rem)] leading-[0.95] tracking-[-0.025em] text-stone-50 font-light">
              Personal finance,
              <br />
              <span className="fraunces-italic text-gold-accent">kept personal.</span>
            </h2>
            <p className="mt-8 max-w-md text-stone-400 text-lg leading-relaxed">
              Open source. Run it on your terms.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/auth/signup"
                className="group inline-flex items-center gap-3 bg-gold-accent hover:bg-gold-accent-hover text-stone-950 px-7 py-3.5 text-sm font-medium tracking-wide rounded-full transition-colors"
              >
                Request an invite
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>
          </div>

          <div className="space-y-10 md:text-right">
            <div className="flex md:justify-end items-center gap-2.5">
              <Logo size={22} className="text-gold-accent" />
              <span
                className="fraunces text-base tracking-tight text-stone-100"
                style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
              >
                Privance
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-400 md:justify-items-end">
              <a href="#features" className="hover:text-stone-100 transition-colors">
                Features
              </a>
              <a href="#protocol" className="hover:text-stone-100 transition-colors">
                Protocol
              </a>
              <a href="#tenets" className="hover:text-stone-100 transition-colors">
                Tenets
              </a>
              <a href="#threats" className="hover:text-stone-100 transition-colors">
                Threat model
              </a>
              <a href="#faq" className="hover:text-stone-100 transition-colors">
                FAQ
              </a>
              <Link href="/auth/login" className="hover:text-stone-100 transition-colors">
                Sign in
              </Link>
              <Link href="/auth/signup" className="hover:text-stone-100 transition-colors">
                Sign up
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-24 pt-8 border-t border-stone-900 flex flex-wrap items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.22em] text-stone-600">
          <span>AGPL-3.0 · 2026 · Privance</span>
          <span>privance.app</span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const { state } = useAuth();

  useEffect(() => {
    if (state === "unlocked") window.location.replace("/app/");
    else if (state === "locked") window.location.replace("/unlock/");
  }, [state]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Avoid flashing the landing for signed-in users mid-redirect.
  if (state !== "unauthenticated") return null;

  return (
    <>
      <NavBar scrolled={scrolled} />
      <main className="relative pt-16">
        <Hero />
        <Features />
        <Protocol />
        <Tenets />
        <ThreatModel />
        <FAQ />
        <Footer />
      </main>
    </>
  );
}
