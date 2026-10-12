export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// English messages; callers may pass `t` (from useT) to show the same message in the chosen language.
const EN = {
  "valid.pwShort": "Use at least 8 characters.",
  "valid.pwLong": "Password is too long (max 72 bytes).",
  "valid.pwMix": "Include at least one letter and one number.",
  "valid.required": "{label} is required.",
  "valid.number": "{label} must be a number.",
  "valid.range": "{label} must be between {min} and {max}.",
};
const msg = (t, key, vars = {}) => (t ? t(key, vars) : EN[key].replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)));

export function validatePassword(v, t) {
  if (!v || v.length < 8) return msg(t, "valid.pwShort");
  if (new TextEncoder().encode(v).length > 72) return msg(t, "valid.pwLong");
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return msg(t, "valid.pwMix");
  return null;
}

/** Validate a numeric field against [min, max]. Returns an error string or null. */
export function numberInRange(value, min, max, label, t) {
  if (value === "" || value == null) return msg(t, "valid.required", { label });
  const n = Number(value);
  if (Number.isNaN(n)) return msg(t, "valid.number", { label });
  if (n < min || n > max) return msg(t, "valid.range", { label, min, max });
  return null;
}
