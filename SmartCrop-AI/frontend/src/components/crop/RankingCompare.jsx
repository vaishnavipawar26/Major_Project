import { Coins, Percent } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { rankingCompare } from "../../utils/cropPlan";
import { cropName, rupees } from "../../utils/format";

function Pair({ rows, max }) {
  return (
    <ul className="why-rows">
      {rows.map((r) => (
        <li key={r.name} className={r.lead ? "is-lead" : ""}>
          <span className="why-name">{r.name}</span>
          <span className="why-bar"><span style={{ width: `${Math.max(4, (r.n / max) * 100)}%` }} /></span>
          <span className="why-val num">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Why X ranks first", shown under the comparison chart. Everything is built from the API response: the
 * crop with the highest total profit against the best overall crop, as two separate comparisons (total
 * profit, and profit per Rs 100 spent). Nothing is shown when no crop is recommended.
 */
export default function RankingCompare({ response }) {
  const t = useT();
  const c = rankingCompare(response);
  if (!c) return null; // one crop wins both, or the data is missing: render nothing at all

  const b = cropName(t, c.best.crop_name), h = cropName(t, c.top.crop_name);
  const p = { best: b, top: h, gap: rupees(c.gap) };
  const be = c.best.economics, te = c.top.economics;
  const intro = c.roiShown ? (c.cheaper ? "cr.why.introCheaper" : "cr.why.introReturn") : "cr.why.introOther";
  return (
    <section className="why-box" aria-label={t("cr.why.title", p)}>
      <h3 className="why-title">{t("cr.why.title", p)}</h3>
      <p>{t(intro, p)}</p>

      <div className="why-grid">
        <div className="why-panel">
          <h4><Coins size={16} aria-hidden="true" />{t("cr.why.totalTitle")}</h4>
          <Pair max={Math.max(be.net_profit, te.net_profit)} rows={[
            { name: b, n: be.net_profit, value: rupees(be.net_profit) },
            { name: h, n: te.net_profit, value: rupees(te.net_profit), lead: true }]} />
          <p className="why-note">{t("cr.why.totalNote", p)}</p>
          <p className="why-sub">{t("cr.why.costs", { ...p, bestCost: rupees(be.total_cost), topCost: rupees(te.total_cost) })}</p>
        </div>
        {c.roiShown && (
          <div className="why-panel">
            <h4><Percent size={16} aria-hidden="true" />{t("cr.why.roiTitle")}</h4>
            <Pair max={Math.max(c.roi.best, c.roi.top)} rows={[
              { name: b, n: c.roi.best, value: t("cr.why.about", { v: rupees(c.roi.best) }), lead: true },
              { name: h, n: c.roi.top, value: t("cr.why.about", { v: rupees(c.roi.top) }) }]} />
            <p className="why-note">{t("cr.why.roiNote", { ...p, diff: rupees(c.roiDiff) })}</p>
          </div>
        )}
      </div>

      {c.reasons.length > 0 && (
        <ul className="why-more">{c.reasons.map((x) => <li key={x.code}>{t(`cr.why.${x.code}`, { ...p, ...x.params })}</li>)}</ul>
      )}
      {c.canChoose && <p className="why-choose">{t("cr.why.choose", p)}</p>}

    </section>
  );
}
