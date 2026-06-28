import { CloseButton } from "@/components";
import { DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function Row({
  icon,
  name,
  description,
  trailing,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const inner = (
    <>
      <span
        className={[
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2",
          danger ? "text-down" : "text-accent",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className={["block text-base", danger ? "text-down" : "text-cream"].join(" ")}>
          {name}
        </span>
        {description && (
          <span className="mt-[3px] block font-mono text-xs tracking-[0.04em] text-faint">
            {description}
          </span>
        )}
      </span>
      {trailing}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 border-b border-line-soft px-[22px] py-[18px] last:border-b-0 cursor-pointer bg-transparent transition-colors hover:bg-cream/2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-4 border-b border-line-soft px-[22px] py-[18px] last:border-b-0">
      {inner}
    </div>
  );
}

export function Badge({
  label,
  variant = "off",
}: {
  label: string;
  variant?: "on" | "off" | "unavailable";
}) {
  const cls = variant === "on" ? "text-accent border-accent/25" : "text-faint border-line";
  return (
    <span
      className={[
        "shrink-0 rounded-full border px-[11px] py-[5px] font-mono text-xs uppercase tracking-label",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export function Caret() {
  return <span className="shrink-0 text-faint text-lg leading-none">&rsaquo;</span>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-faint">{children}</p>
  );
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden glass rounded-[10px]">{children}</div>;
}

export function Toggle({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return <Switch checked={on} onCheckedChange={onToggle} aria-label={label} />;
}

export function SettingsDialogHeader({
  title,
  titleId,
  onClose,
  danger = false,
}: {
  title: string;
  titleId: string;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <div className="mb-[18px] flex items-center justify-between">
      <DialogTitle asChild>
        <h3
          id={titleId}
          className={cn(
            "font-serif font-normal text-2xl tracking-[-0.01em]",
            danger && "text-down",
          )}
        >
          {title}
        </h3>
      </DialogTitle>
      <CloseButton onClick={onClose} />
    </div>
  );
}

export function PhraseGrid({ phrase }: { phrase: string }) {
  const words = phrase.split(" ").map((word, i) => ({ word, num: i + 1 }));
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Recovery phrase words</legend>
      <div className="mt-[22px] grid gap-[9px]" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {words.map(({ word, num }) => (
          <div
            key={num}
            className="flex items-baseline gap-[9px] rounded-[7px] border border-line bg-panel-2 px-[13px] py-[11px] font-mono text-sm"
          >
            <span className="w-[14px] flex-none text-xs text-faint">{num}</span>
            {word}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
