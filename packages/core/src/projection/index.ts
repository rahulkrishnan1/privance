export type { ReturnRow } from "./dataset.js";
export {
  ANNUAL_RETURNS,
  DATASET_END_YEAR,
  DATASET_START_YEAR,
} from "./dataset.js";
export type { SimulatePlanOptions, SimulateResult } from "./engine.js";
export { simulatePlan } from "./engine.js";
export type { Milestone, MilestoneKey, MilestonesInput } from "./milestones.js";
export { computeMilestones } from "./milestones.js";
export { MAX_ABS_ERROR_CENTRAL, MAX_ABS_ERROR_TAIL, normalSample } from "./normal.js";
export type { AllocationParams, Preset, PresetId } from "./presets.js";
export {
  deriveAllocationParams,
  getPreset,
  PRESET_AGGRESSIVE,
  PRESET_BALANCED,
  PRESET_CONSERVATIVE,
  PRESETS,
} from "./presets.js";
export type { Sfc32 } from "./random.js";
export { makeSfc32, seededRng, xmur3Seed } from "./random.js";
export type {
  McResult,
  ReplayResult,
  Sfc32State,
  SimSeed,
  WorstCohort,
  YearBand,
} from "./types.js";
export { asSimSeed } from "./types.js";
