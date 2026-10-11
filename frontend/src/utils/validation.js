export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function validatePassword(v) {
  if (!v || v.length < 8) return "Use at least 8 characters.";
  if (new TextEncoder().encode(v).length > 72) return "Password is too long (max 72 bytes).";
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Include at least one letter and one number.";
  return null;
}

/** Validate a numeric field against [min, max]. Returns an error string or null. */
export function numberInRange(value, min, max, label) {
  if (value === "" || value == null) return `${label} is required.`;
  const n = Number(value);
  if (Number.isNaN(n)) return `${label} must be a number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return null;
}
