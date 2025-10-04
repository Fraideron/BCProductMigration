// String utility functions

/**
 * Normalize string for comparison (remove diacritics, lowercase, trim)
 */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Compare two names (case-insensitive, trimmed)
 */
export function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}
