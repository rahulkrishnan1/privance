"use client";

import { DATASET_START_YEAR } from "@privance/core/projection";
import { formatPercentWhole } from "@/lib/format";
import { InfoTip } from "./info-tip";

type ConfidenceCardProps = {
  successRate: number;
  planUntilAge: number;
  survivalShare: number;
};

// ---------------------------------------------------------------------------
// Gauge: a ring filled clockwise to `fraction` of its circumference.
// ---------------------------------------------------------------------------

function Gauge({ fraction }: { fraction: number }) {
  const r = 33;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(1, Math.max(0, fraction)));
  return (
    <svg width={72} height={72} viewBox="0 0 80 80" aria-hidden="true" className="shrink-0">
      <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
      <circle
        cx={40}
        cy={40}
        r={r}
        fill="none"
        stroke="var(--color-gold-accent)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out"
      />
    </svg>
  );
}

const EYEBROW =
  "font-mono text-[9px] tracking-[0.14em] uppercase text-gold-accent flex items-center";
const BIG = "text-[32px] font-semibold tracking-[-0.02em] leading-none mt-2 tabular-nums";
const CAP = "text-[13px] text-app-muted mt-1.5 leading-snug";

/**
 * "Will your money last": the two simulation methods side by side, each a gauge
 * ring + headline percentage. Kept deliberately clean -- the dataset source line
 * sits at the page bottom.
 */
export function ConfidenceCard({ successRate, planUntilAge, survivalShare }: ConfidenceCardProps) {
  return (
    <section aria-label="Will your money last">
      <h2 className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim mb-4">
        Will your money last
      </h2>

      <div className="flex flex-col rounded-2xl border border-app-line bg-app-panel md:flex-row">
        <section
          aria-label="Monte Carlo simulation"
          className="flex items-center gap-[18px] p-6 md:flex-1"
        >
          <Gauge fraction={successRate} />
          <div className="min-w-0">
            <p className={EYEBROW}>
              Monte Carlo
              <InfoTip
                label="What is Monte Carlo?"
                text="Simulates thousands of randomized market futures from your plan and counts how many still have money left at the end."
              />
            </p>
            <p className={BIG} data-testid="mc-success-rate">
              {formatPercentWhole(successRate)}
            </p>
            <p className={CAP}>chance it lasts to age {planUntilAge}</p>
          </div>
        </section>

        <section
          aria-label="Historical Replay simulation"
          className="flex items-center gap-[18px] border-t border-app-line-soft p-6 md:flex-1 md:border-t-0 md:border-l"
        >
          <Gauge fraction={survivalShare} />
          <div className="min-w-0">
            <p className={EYEBROW}>
              Historical replay
              <InfoTip
                label="What is Historical Replay?"
                text={`Runs your exact plan through every real stretch of market history since ${DATASET_START_YEAR}, the crashes and recoveries included.`}
              />
            </p>
            <p className={BIG} data-testid="replay-success-rate">
              {formatPercentWhole(survivalShare)}
            </p>
            <p className={CAP}>of real markets since {DATASET_START_YEAR} survived</p>
          </div>
        </section>
      </div>
    </section>
  );
}
