import { CalendarDays, CircleAlert, CircleCheck, CloudRain, IndianRupee, Layers, MapPin, Thermometer, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { buildExplanation } from "../../utils/farmerExplanation";

const TONE_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

/** Status mark: icon plus words, so colour is never the only signal. */
function Status({ tone, children }) {
  const Icon = TONE_ICON[tone];
  if (!Icon) return <span className="xp-status">{children}</span>;
  return <span className={`xp-status is-${tone}`}><Icon size={14} aria-hidden="true" />{children}</span>;
}

/** Small bar: the shaded part is the crop's usual range, the dot is the farmer's value. Decorative; the status says it in words. */
function RangeBar({ bar, tone }) {
  if (!bar) return null;
  return (
    <span className="xp-bar" aria-hidden="true">
      <span className="xp-bar-band" style={{ left: `${bar.from}%`, width: `${bar.to - bar.from}%` }} />
      <span className={`xp-bar-dot is-${tone}`} style={{ left: `${bar.marker}%` }} />
    </span>
  );
}

/** One measurement: name and status on top, the value large, the usual range small, then the bar. */
function Measure({ m, children }) {
  return (
    <div className="xp-measure">
      <div className="xp-measure-top">
        <span className="xp-measure-name">{m.label}</span>
        <Status tone={m.tone}>{m.status}</Status>
      </div>
      <p className="xp-measure-value num">{m.value}</p>
      {children}
      {m.range && <p className="xp-range">{m.range}</p>}
      <RangeBar bar={m.bar} tone={m.tone} />
    </div>
  );
}

/** One numbered step: number, icon, "Title — headline" (headline coloured by tone), then its content. */
export function Step({ n, id, icon: Icon, title, headline, tone = "neutral", children }) {
  return (
    <li className={`xp-step is-${tone}`} aria-labelledby={id}>
      <span className="xp-num" aria-hidden="true">{n}</span>
      <div className="xp-step-body">
        <h3 id={id} className="xp-step-title">
          <Icon size={18} aria-hidden="true" />
          <span>{title}</span><span className="xp-dash" aria-hidden="true">—</span><span className="sr-only">: </span>
          <span className={`xp-headline is-${tone}`}>{headline}</span>
        </h3>
        {children}
      </div>
    </li>
  );
}

/** "Why is [crop] recommended for your farm?": six numbered sections and the AI's final explanation.
 *  All content comes from utils/farmerExplanation.js. */
export default function FarmExplanation({ result, response, inputs }) {
  const t = useT();
  const { crop, location, planning, soil, temperature, rainfall, profit, final } = buildExplanation(result, response, inputs, t);
  const best = result.crop_name === response.best_overall;
  // a section whose data is missing keeps its number and says "Not available" instead of disappearing
  const missing = { headline: t("score.notAvailable"), tone: "neutral", text: t("cr.fx.na") };
  const place = location || missing, when = planning || missing;
  const steps = [
    { key: "location", icon: MapPin, ...place, body: <p className="xp-text">{place.text}</p> },
    { key: "planting", icon: CalendarDays, ...when, body: <p className="xp-text">{when.text}</p> },
    {
      key: "soil", icon: Layers, headline: soil.headline, tone: soil.tone,
      body: (
        <>
          <div className="xp-measures">{soil.rows.map((m) => <Measure key={m.key} m={m} />)}</div>
          <p className="xp-text">{soil.text}</p>
        </>
      ),
    },
    {
      key: "temperature", icon: Thermometer, headline: temperature.headline, tone: temperature.tone,
      body: (
        <>
          <div className="xp-measures is-single"><Measure m={temperature} /></div>
          <p className="xp-text">{temperature.text}</p>
        </>
      ),
    },
    {
      key: "rainfall", icon: CloudRain, headline: rainfall.headline, tone: rainfall.tone,
      body: (
        <>
          <div className="xp-measures is-single"><Measure m={rainfall}>{rainfall.note && <p className="xp-sub">{rainfall.note}</p>}</Measure></div>
          <p className="xp-text">{rainfall.text}</p>
        </>
      ),
    },
    {
      key: "profit", icon: IndianRupee, headline: profit ? profit.headline : t("score.notAvailable"), tone: profit ? profit.tone : "neutral",
      body: profit ? (
        <>
          <div>
            <p className={`xp-profit-amount num${profit.loss ? " is-loss" : ""}`}>{profit.loss ? "−" : ""}{profit.amount}</p>
            <p className="xp-sub">{profit.label}</p>
          </div>
          <dl className="xp-metrics">
            {profit.metrics.map((m) => (
              <div key={m.key}><dt>{m.label}</dt><dd className="num">{m.value}</dd>{m.sub && <dd className="xp-sub">{m.sub}</dd>}</div>
            ))}
          </dl>
          <p className="xp-text">{profit.text}</p>
          {profit.note && <p className="xp-sub">{profit.note}</p>}
        </>
      ) : <p className="xp-text">{t("cr.fx.profit.na")}</p>,
    },
  ];

  return (
    <section className="card xp-section" aria-labelledby="xp-why-title">
      <h2 id="xp-why-title" className="cr-h2">{t(best ? "cr.fx.title" : "cr.fx.titleOther", { crop })}</h2>
      <p className="xp-intro">{t(best ? "cr.fx.subtitle" : "cr.fx.subtitleOther")}</p>
      <ol className="xp-steps">
        {steps.map((s, i) => (
          <Step key={s.key} n={i + 1} id={`xp-${s.key}`} icon={s.icon} title={t(`cr.fx.n.${s.key}`)} headline={s.headline} tone={s.tone}>{s.body}</Step>
        ))}
      </ol>
      <aside className="xp-summary" aria-labelledby="xp-summary-title">
        <h3 id="xp-summary-title">{t("cr.fx.finalTitle")}</h3>
        <p>{final}</p>
        <p className="xp-disclaimer">{t("cr.fx.disclaimer")}</p>
      </aside>
    </section>
  );
}
