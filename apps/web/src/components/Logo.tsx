type LogoProps = {
  size?: number;
  className?: string;
};

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="Privance"
      className={className}
    >
      <rect width="32" height="32" rx="7" className="fill-neutral-950" />
      <path
        d="M 9.5 6.5 L 9.5 25.5 L 13.5 25.5 L 13.5 17.5 L 17.5 17.5 C 21.6 17.5 24 15.0 24 12.0 C 24 9.0 21.6 6.5 17.5 6.5 Z M 13.5 9.5 L 17.0 9.5 C 18.9 9.5 20.0 10.5 20.0 12.0 C 20.0 13.5 18.9 14.5 17.0 14.5 L 13.5 14.5 Z"
        className="fill-gold-400"
      />
    </svg>
  );
}
