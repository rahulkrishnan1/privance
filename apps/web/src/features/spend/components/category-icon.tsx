"use client";

import type { SpendCategory } from "@privance/core";

type IconProps = {
  category: SpendCategory;
  className?: string;
};

const PATHS: Record<SpendCategory, string> = {
  housing: "M3 11l9-7 9 7M5 10v10h14V10",
  utilities: "M13 2 4 14h7l-1 8 9-12h-7z",
  phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 18h4",
  insurance: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  health: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
  // transport, music, and gaming have dedicated sub-components; paths here satisfy
  // the Record<SpendCategory, string> constraint but are never rendered via this table
  transport: "M5 16l1-5h12l1 5M4 16h16v3H4",
  streaming: "M5 3l14 9-14 9z",
  music: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
  software: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  cloud_storage: "M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7",
  news: "M4 5h16v14H4zM8 9h8M8 13h8M8 17h5",
  fitness: "M6 8v8M18 8v8M4 10v4M20 10v4M6 12h12",
  shopping: "M6 2l2 4h8l2-4M4 6h16v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  food: "M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM6 1v3M10 1v3M14 1v3",
  education: "M22 10v6M2 10l10-5 10 5-10 5zM6 12v5c3 3 9 3 12 0v-5",
  gaming: "M6 11h4M8 9v4M15 12h.01M18 12h.01",
  other: "M12 12h.01M7 12h.01M17 12h.01",
};

// Transport uses circles for wheels -- handled as a multi-path component
function TransportIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path d="M5 16l1-5h12l1 5M4 16h16v3H4z" />
      <circle cx="7.5" cy="19" r="1.3" />
      <circle cx="16.5" cy="19" r="1.3" />
    </svg>
  );
}

// Music uses arcs to suggest a streaming logo
function MusicIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M7 10c4-1 7-.5 10 1M7.5 13.5c3-.7 5.5-.3 8 1" />
    </svg>
  );
}

// Gaming is a full controller body with a D-pad and round buttons; round caps
// render the button dots (the lone D-pad cross alone read as a stray plus).
function GamingIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 11h4M8 9v4M15 12h.01M18 11h.01" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.01.05-.01.1-.02.15C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 10.83 16h2.34a2 2 0 0 1 1.42.59L16 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.6-6.58-.68-7.26-.01-.05-.01-.1-.02-.15A4 4 0 0 0 17.32 5z" />
    </svg>
  );
}

export function CategoryIcon({ category, className = "w-4 h-4" }: IconProps) {
  if (category === "transport") return <TransportIcon className={className} />;
  if (category === "music") return <MusicIcon className={className} />;
  if (category === "gaming") return <GamingIcon className={className} />;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path d={PATHS[category]} />
    </svg>
  );
}
