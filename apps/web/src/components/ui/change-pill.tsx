import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const changePillVariants = cva("inline-block w-[76px] rounded-md text-center font-mono", {
  variants: {
    tone: {
      up: "text-up bg-up/12",
      down: "text-down bg-down/12",
      flat: "text-dim bg-cream/6",
    },
    size: {
      xs: "text-xs",
      sm: "text-sm",
    },
    // `roomy` matches a standalone pill's height to the stacked size-sm pill;
    // `tight` is for pills stacked under a value.
    pad: {
      tight: "py-0.5",
      roomy: "py-1",
    },
  },
  defaultVariants: { tone: "flat", size: "xs", pad: "tight" },
});

export type ChangeTone = NonNullable<VariantProps<typeof changePillVariants>["tone"]>;

type ChangePillProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof changePillVariants>;

/** Fixed-width up/down/flat tinted pill for a signed percent or change value. */
export function ChangePill({ tone, size, pad, className, ...props }: ChangePillProps) {
  return <span className={cn(changePillVariants({ tone, size, pad }), className)} {...props} />;
}
