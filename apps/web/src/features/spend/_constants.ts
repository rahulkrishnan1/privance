import type { BillingUnit, SpendCategory, SpendGroup } from "@privance/core";

// Human-readable labels keyed off the core enums. The Record types make a new
// category or cycle a compile error here until it is labelled.
export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  housing: "Housing",
  utilities: "Utilities",
  phone: "Phone",
  insurance: "Insurance",
  health: "Health",
  transport: "Transport",
  food: "Food",
  streaming: "Streaming",
  music: "Music",
  software: "Software",
  cloud_storage: "Cloud Storage",
  news: "News",
  fitness: "Fitness",
  shopping: "Shopping",
  education: "Education",
  gaming: "Gaming",
  other: "Other",
};

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

export const GROUP_LABELS: Record<SpendGroup, string> = {
  essentials: "Essentials",
  subscriptions: "Subscriptions",
};

// Categories that default into the Essentials panel; everything else defaults to
// Subscriptions. Only a starting suggestion now, the group is user-chosen.
export const ESSENTIALS_CATEGORIES: ReadonlySet<SpendCategory> = new Set([
  "housing",
  "utilities",
  "phone",
  "insurance",
  "health",
  "transport",
  "food",
]);
