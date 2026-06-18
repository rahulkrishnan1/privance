type LogoProps = {
  size?: number;
  className?: string;
  /** When true the SVG is decorative; caller provides the accessible label. */
  "aria-hidden"?: boolean;
};

/**
 * Keyhole P mark. The P stroke takes `currentColor` so callers set it via text
 * color; the keyhole (circle + dropped triangle) stays Tide teal as the fixed
 * brand accent.
 */
export function Logo({ size = 32, className, "aria-hidden": ariaHidden }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : "Privance"}
      aria-hidden={ariaHidden}
      className={className}
    >
      <path
        d="M20 58 V8 H38 a16 16 0 0 1 0 32 H28"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="38" cy="22" r="4.6" fill="#7FC4C6" />
      <path d="M38 24 l-3.4 9.5 h6.8 Z" fill="#7FC4C6" />
    </svg>
  );
}
