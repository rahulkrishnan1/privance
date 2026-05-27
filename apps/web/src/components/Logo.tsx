import { useId } from "react";

type LogoProps = {
  size?: number;
  className?: string;
};

export function Logo({ size = 32, className }: LogoProps) {
  const reactId = useId();
  const clipId = `privance-mark-${reactId}`;
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-label="Privance"
      className={className}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="80" cy="80" r="58" />
        </clipPath>
      </defs>
      <circle cx="80" cy="80" r="58" fill="none" stroke="currentColor" strokeWidth="3" />
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <line x1="80" y1="6" x2="80" y2="18" />
        <line x1="154" y1="80" x2="142" y2="80" />
        <line x1="80" y1="154" x2="80" y2="142" />
        <line x1="6" y1="80" x2="18" y2="80" />
      </g>
      <g
        stroke="currentColor"
        strokeWidth="2.8"
        fill="none"
        strokeLinecap="square"
        clipPath={`url(#${clipId})`}
      >
        <path d="M 40 48 L 105 48" />
        <path d="M 105 48 L 105 65" />
        <path d="M 55 65 L 120 65" />
        <path d="M 55 65 L 55 90" />
        <path d="M 55 90 L 105 90" />
        <path d="M 35 82 L 35 108" />
        <path d="M 80 90 L 80 108" />
        <path d="M 105 90 L 105 115" />
        <path d="M 55 108 L 105 108" />
      </g>
      <circle cx="70" cy="78" r="8" fill="currentColor" />
      <circle cx="70" cy="78" r="4.5" fill="#0a0a0a" />
      <circle cx="70" cy="78" r="1.8" fill="currentColor" />
    </svg>
  );
}
