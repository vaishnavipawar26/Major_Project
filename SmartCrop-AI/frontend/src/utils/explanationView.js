/** True when an explanation response belongs to the request it is shown for. */
export function matchesRequest(req, explain) {
  if (!req || !explain) return false;
  return String(explain.series?.commodity || "").toLowerCase() === String(req.commodity || "").toLowerCase()
    && explain.target_date === req.target_date;
}
