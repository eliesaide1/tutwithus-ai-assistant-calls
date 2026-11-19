const TIME_ZONE_STORAGE_KEY = 'tutwithus.browserTimeZone';

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone(): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = detected && isValidTimeZone(detected) ? detected : 'UTC';
  try {
    window.sessionStorage.setItem(TIME_ZONE_STORAGE_KEY, timeZone);
  } catch {
    // Storage may be unavailable in privacy modes. Detection still works.
  }
  return timeZone;
}
