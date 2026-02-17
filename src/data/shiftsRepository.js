const STORAGE_KEY = 'shifts';

export function loadShifts({ fallback = [] } = {}) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function persistShifts(shifts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shifts));
  } catch {
    // Ignore storage write errors (private mode, quota, etc.)
  }
}
