const KEY = 'settings.units';
let unit: 'kmh' | 'mph' = 'kmh';
try {
  if (localStorage.getItem(KEY) === 'mph') unit = 'mph';
} catch {
  /* In-memory settings. */
}
export function speedUnit(): 'kmh' | 'mph' {
  return unit;
}
export function setSpeedUnit(value: 'kmh' | 'mph'): void {
  unit = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* In-memory settings. */
  }
}
