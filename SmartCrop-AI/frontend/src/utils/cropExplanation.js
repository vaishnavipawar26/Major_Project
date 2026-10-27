// Helpers for the crop explanation page. Scores, money and ranges are always the API's own numbers;
// these functions only choose which crop to explain and compare the API's score points.
export const SCORE_PARTS = ["agronomic", "timing", "profit"];
// score-point differences smaller than this are treated as a tie
const TIE = 0.05;

/** The crop to explain: the best overall crop, else the top-ranked one. */
export const recommendedCrop = (response) =>
  response?.results?.find((r) => r.crop_name === (response.recommended_crop ?? response.best_overall)) || null;

/** A response the page can explain: it must carry the fields the sections read. */
export const isExplainable = (data) => {
  const r = data?.response?.results;
  return !!(data?.req && r?.length && r[0].score_points && r[0].range_fit && r[0].timeline);
};

/** How `other` differs from `best`, part by part, using the API's weighted score points. */
export function compareToBest(best, other) {
  const diffs = SCORE_PARTS.map((part) => ({ part, diff: best.score_points[part] - other.score_points[part] }));
  return {
    gap: best.recommendation_score - other.recommendation_score,
    behind: diffs.filter((d) => d.diff > TIE).sort((a, b) => b.diff - a.diff).map((d) => d.part),
    ahead: diffs.filter((d) => d.diff < -TIE).sort((a, b) => a.diff - b.diff).map((d) => d.part),
  };
}
