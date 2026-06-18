// Veil display-preference storage: the live figures toggle and the "start
// veiled" preference. Writes are best-effort; storage throws in private-mode
// browsers, where the Veil stays off.

const VEIL_KEY = "privance.veil.v1";
const VEIL_START_KEY = "privance.veilStart.v1";

export function readVeil(): boolean {
  try {
    return localStorage.getItem(VEIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeVeil(on: boolean): void {
  try {
    localStorage.setItem(VEIL_KEY, on ? "1" : "0");
  } catch {
    // Best-effort persistence only.
  }
}

export function readStartVeil(): boolean {
  try {
    return localStorage.getItem(VEIL_START_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStartVeil(on: boolean): void {
  try {
    localStorage.setItem(VEIL_START_KEY, on ? "1" : "0");
  } catch {
    // Best-effort persistence only.
  }
}

// Set the veil to the start-veiled preference. Called from the auth context on
// sign-in / unlock so the veil resets each session; a survive-refresh reload
// skips this path and keeps the current toggle.
export function applyStartVeilOnAuth(): void {
  writeVeil(readStartVeil());
}
