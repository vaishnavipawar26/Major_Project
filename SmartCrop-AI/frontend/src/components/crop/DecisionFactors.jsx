import { Banknote, CalendarDays, CircleAlert, CircleCheck, CloudSun, MapPin, Sprout, Sparkles, TrendingUp } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { decisionFactors, planReason } from "../../utils/decisionFactors";

const ICON = { location: MapPin, timing: CalendarDays, soil: Sprout, weather: CloudSun, profit: TrendingUp, budget: Banknote };

/** One value on its usual-range track: the green band is the crop's usual range, the dot is the farmer's value. */
function RangeRow({ r }) {
  return (
    <li className={`df-row is-${r.state}`}>
      <span className="df-row-label">{r.label}</span>
      <span className="df-range" aria-hidden="true">
        <span className="df-band" style={{ left: `${r.lowPct}%`, width: `${r.highPct - r.lowPct}%` }} />
        <span className="df-dot" style={{ left: `${r.pos}%` }} />
      </span>
      <span className="df-row-val num">{r.value}</span>
    </li>
  );
}

/** The highlighted strongest reason (only when the farmer's plan chose the crop) and the six decision factors as small visual cards. */
export default function DecisionFactors({ best, response, inputs }) {
  const t = useT();
  const cards = decisionFactors(best, response, inputs, t);
  const reason = planReason(best, response, t);
  if (!cards) return null;
  return (
    <section className="card df-section" aria-labelledby="df-title" data-testid="decision-factors">
      {reason && (
        <div className="inf-top df-reason" role="group" aria-label={t("cr.df.reasonTitle")}>
          <span className="inf-top-icon" aria-hidden="true"><Sparkles size={22} /></span>
          <div className="min-w-0">
            <p className="inf-top-label">{t("cr.df.reasonTitle")}</p>
            <p className="inf-top-text df-reason-text">{reason.text}</p>
          </div>
        </div>
      )}
      <h2 id="df-title" className="inf-title">{t("cr.df.title")}</h2>
      <p className="inf-sub">{t("cr.df.sub")}</p>
      <div className="df-grid">
        {cards.map((c) => {
          const Icon = ICON[c.key];
          const Mark = c.tone === "good" ? CircleCheck : CircleAlert;
          return (
            <article key={c.key} className={`df-card is-${c.tone}${c.decided ? " is-decided" : ""}`} data-testid={`factor-${c.key}`}>
              <header><span className="df-name"><Icon size={16} aria-hidden="true" />{t(`cr.df.f.${c.key}`)}</span><Mark size={18} aria-hidden="true" className="df-mark" /></header>
              <strong className="df-big num">{c.big}</strong>
              {c.bar != null && <span className="pv-track"><span className={`is-${c.tone}`} style={{ width: `${Math.max(3, c.bar)}%` }} /></span>}
              <p className="df-text">{c.text}</p>
              {c.rows && <ul className="df-rows">{c.rows.map((r) => <RangeRow key={r.key} r={r} />)}</ul>}
              {c.decided && <span className="df-decided">{t("cr.df.decided")}</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
