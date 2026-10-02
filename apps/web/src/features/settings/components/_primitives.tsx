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
  href,
  danger = false,
}: {
  icon: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const inner = (
    <>
      <span
        className={[
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-line bg-panel-2",
          danger ? "text-down" : "text-accent",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span
          className={["block text-[15px] leading-5", danger ? "text-down" : "text-cream"].join(" ")}
        >
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
  const interactiveRowClassName =
    "flex w-full items-center gap-3.5 border-b border-line-soft px-[18px] py-4 last:border-b-0 cursor-pointer bg-transparent transition ease-out duration-150 pointer-fine:hover:bg-panel-2 active:bg-panel-2 active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={interactiveRowClassName}>
        {inner}
      </button>
    );
  }

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={interactiveRowClassName}>
        {inner}
      </a>
    );
  }

  return (
    <div className="flex items-center gap-3.5 border-b border-line-soft px-[18px] py-4 last:border-b-0">
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

export function SectionLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-faint">
      {children}
    </h2>
  );
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden glass rounded-[14px]">{children}</div>;
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
      <DialogTitle
        render={
          // biome-ignore lint/a11y/useHeadingContent: heading text is injected as children by Base UI's render prop
          <h3
            id={titleId}
            className={cn(
              "font-serif font-normal text-2xl tracking-[-0.01em]",
              danger && "text-down",
            )}
          />
        }
      >
        {title}
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
