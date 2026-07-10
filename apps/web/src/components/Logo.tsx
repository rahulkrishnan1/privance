type LogoProps = {
  size?: number;
  className?: string;
  /** When true the SVG is decorative; caller provides the accessible label. */
  "aria-hidden"?: boolean;
};

/**
 * Lock + bars mark. The padlock takes `currentColor` so callers set it via text
 * color; the ascending bars stay Tide teal as the fixed brand accent.
 */
export function Logo({ size = 32, className, "aria-hidden": ariaHidden }: LogoProps) {
  return (
    <svg
      viewBox="12 10 136 136"
      width={size}
      height={size}
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : "Privance"}
      aria-hidden={ariaHidden}
      className={className}
    >
      <path
        d="M54 64 V42 a26 26 0 0 1 52 0 V64"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <rect
        x="30"
        y="64"
        width="100"
        height="76"
        rx="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
      />
      <rect x="53.5" y="102" width="12.7" height="20.8" rx="3.2" fill="#5EEAD4" />
      <rect x="73.6" y="92" width="12.7" height="30.8" rx="3.2" fill="#5EEAD4" />
      <rect x="93.8" y="81.2" width="12.7" height="41.6" rx="3.2" fill="#5EEAD4" />
    </svg>
  );
}
