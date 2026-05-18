"use client";

import type { AllocationSlice } from "@privance/core";
import { AllocationPie } from "./allocation-pie";

type AllocationGridProps = {
  byKind: AllocationSlice[];
  byAssetClass?: AllocationSlice[];
  byRegion?: AllocationSlice[];
};

export function AllocationGrid({ byKind }: AllocationGridProps) {
  return (
    <div className="mb-4">
      <AllocationPie title="Allocation" slices={byKind} />
    </div>
  );
}
