// ISO 3166-1 alpha-2 country → coarse geographic region.
//
// Yahoo's quoteSummary returns `country` (e.g., "United States") for equities
// but doesn't surface a region. For the dashboard's geography pie we coalesce
// countries into a small set of regions, finer detail isn't useful at the
// chart scale and we don't track holdings-level exposure inside ETFs.
//
// Countries not listed here fall through to undefined → "Unknown" in the pie.

const NORTH_AMERICA = new Set(["United States", "Canada", "Mexico", "US", "CA", "MX"]);

const EUROPE = new Set([
  "United Kingdom",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "Netherlands",
  "Switzerland",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Belgium",
  "Ireland",
  "Austria",
  "Portugal",
  "Poland",
  "Greece",
  "Czech Republic",
  "Hungary",
  "Luxembourg",
  "GB",
  "DE",
  "FR",
  "IT",
  "ES",
  "NL",
  "CH",
  "SE",
  "NO",
  "DK",
  "FI",
  "BE",
  "IE",
  "AT",
  "PT",
  "PL",
  "GR",
  "CZ",
  "HU",
  "LU",
]);

const ASIA_PACIFIC = new Set([
  "Japan",
  "China",
  "Hong Kong",
  "Taiwan",
  "South Korea",
  "Singapore",
  "Australia",
  "New Zealand",
  "India",
  "Indonesia",
  "Thailand",
  "Vietnam",
  "Malaysia",
  "Philippines",
  "JP",
  "CN",
  "HK",
  "TW",
  "KR",
  "SG",
  "AU",
  "NZ",
  "IN",
  "ID",
  "TH",
  "VN",
  "MY",
  "PH",
]);

const LATIN_AMERICA = new Set([
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "BR",
  "AR",
  "CL",
  "CO",
  "PE",
]);

const MIDDLE_EAST_AFRICA = new Set([
  "Israel",
  "Saudi Arabia",
  "United Arab Emirates",
  "Qatar",
  "South Africa",
  "Egypt",
  "Turkey",
  "IL",
  "SA",
  "AE",
  "QA",
  "ZA",
  "EG",
  "TR",
]);

export function regionFromCountry(country: string | undefined): string | undefined {
  if (country === undefined) return undefined;
  if (NORTH_AMERICA.has(country)) return "North America";
  if (EUROPE.has(country)) return "Europe";
  if (ASIA_PACIFIC.has(country)) return "Asia Pacific";
  if (LATIN_AMERICA.has(country)) return "Latin America";
  if (MIDDLE_EAST_AFRICA.has(country)) return "Middle East & Africa";
  return undefined;
}
