"use client";

/**
 * Client-only advisory strength meter. The score is a local heuristic; it is
 * never sent to the server.
 */
function scorePassword(password: string): number {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes >= 2) score += 1;
  if (classes >= 3) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_LABELS = ["Enter a password", "Weak", "Fair", "Good", "Strong"];

export function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  const fill = "bg-accent";
  return (
    <div className="mt-[9px]">
      <div className="flex gap-[5px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`flex-1 h-[3px] rounded-[2px] ${i < score ? fill : "bg-cream/10"}`}
          />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        Password strength: {STRENGTH_LABELS[score]}
      </span>
    </div>
  );
}
