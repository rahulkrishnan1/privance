export {
  DATASET_END_YEAR,
  DATASET_START_YEAR,
} from "./dataset.js";
export type { SimulatePlanOptions, SimulateResult } from "./engine.js";
export { simulatePlan } from "./engine.js";
export type { Milestone, MilestoneKey } from "./milestones.js";
export { computeMilestones } from "./milestones.js";
export type { PresetId } from "./presets.js";
export {
  deriveAllocationParams,
  getPreset,
  PRESET_BALANCED,
  PRESETS,
} from "./presets.js";
export type { YearBand } from "./types.js";
export { asSimSeed } from "./types.js";
