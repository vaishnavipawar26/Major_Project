import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpenCheck, CalendarDays, ChartNoAxesCombined, ChevronRight, CircleCheckBig, Compass, History, Info, Sprout,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import DirectionBadge from "../components/DirectionBadge";
import { startTour } from "../components/GuidedTour";
import Tip from "../components/Tip";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n/LanguageContext";
import { historyService } from "../services/historyService";
import { addDays, compactRupees, cropName, fmtDate, monthShort, rupees, titleCase, topCrops } from "../utils/format";
import heroPhoto from "../assets/photos/hero-farmer.webp";

const RECENT = 3;
const HERO_SEEN_KEY = "smartcrop_hero_seen"; // the hero intro animation plays once per browser session

function greetingKey(hour) {
  if (hour < 12) return "dash.morning";
  if (hour < 17) return "dash.afternoon";
  return "dash.evening";
}

/** Tiny line of a saved forecast: starting price followed by the saved daily predictions (decorative; numbers are shown as text). */
function Sparkline({ start, path }) {
  const values = [start, ...path.map((p) => p.predicted_price)].filter((v) => v != null);
  if (values.length < 2) return null;
  const w = 96, h = 30, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - lo) / span) * (h - 6)}`).join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="var(--series-forecast)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RecentPrices({ items, total }) {
  const t = useT();
  return (
    <section className="card recent-card reveal" aria-labelledby="recent-prices">
      <div className="recent-head">
        <h3 id="recent-prices" className="section-title"><ChartNoAxesCombined size={18} aria-hidden="true" />{t("dash.recentPrices")}</h3>
        <span className="count-chip">{total}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted !mb-0">{t("dash.noPrices")} <Link to="/price-prediction">{t("dash.checkPrice")}</Link></p>
      ) : (
        <ul className="recent-list">
          {items.slice(0, RECENT).map((p) => (
            <li key={p.id}>
              <Link to={`/price-prediction/result?id=${p.id}`} className="recent-item">
                <CropArt crop={p.commodity} size={56} className="recent-art" decorative />
                <span className="recent-main">
                  <strong>{cropName(t, p.commodity)}</strong>
                  <span className="muted small">{p.market === "All markets (state median)" ? t("price.form.allMarkets") : p.market} · {t("dash.savedOn", { date: fmtDate(p.created_at) })}</span>
                  <span className="recent-value">{t("dash.expectedOn", { price: rupees(p.predicted_price), date: fmtDate(addDays(p.input_date, p.horizon_days)) })}</span>
                </span>
                <span className="recent-side">
                  <Sparkline start={p.current_price} path={p.future_trend || []} />
                  <DirectionBadge direction={p.predicted_direction} />
                </span>
                <span className="recent-open">{t("dash.open")}<ChevronRight size={16} aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentCrops({ items, total }) {
  const t = useT();
  return (
    <section className="card recent-card reveal" style={{ "--i": 1 }} aria-labelledby="recent-crops">
      <div className="recent-head">
        <h3 id="recent-crops" className="section-title"><Sprout size={18} aria-hidden="true" />{t("dash.recentCrops")}</h3>
        <span className="count-chip">{total}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted !mb-0">{t("dash.noCrops")} <Link to="/crop-recommendation">{t("dash.findCrop")}</Link></p>
      ) : (
        <ul className="recent-list">
          {items.slice(0, RECENT).map((r) => {
            const best = topCrops(r.results);
            return (
              <li key={r.id}>
                <Link to={`/crop-recommendation/result?id=${r.id}`} className="recent-item">
                  <CropArt crop={best[0] ? titleCase(best[0].crop_name) : null} size={56} className="recent-art" decorative />
                  <span className="recent-main">
                    <strong>{best.length ? best.map((x) => cropName(t, titleCase(x.crop_name))).join(", ") : t("hist.noneSuitable")}</strong>
                    <span className="muted small">
                      {r.city ? `${cropName(t, r.city, "city")} · ` : ""}{monthShort(r.month)}{r.selling_month ? ` → ${monthShort(r.selling_month)}` : ""}
                      {" · "}{t("dash.savedOn", { date: fmtDate(r.created_at) })}
                    </span>
                    {best[0] && (
                      <span className="recent-value">
                        {best[0].recommendation_score != null && t("dash.score", { score: Math.round(best[0].recommendation_score) })}
                        {best[0].recommendation_score != null && best[0].expected_profit != null && " · "}
                        {best[0].expected_profit != null && t("dash.bestProfitShort", { profit: compactRupees(best[0].expected_profit) })}
                      </span>
                    )}
                  </span>
                  <span className="recent-open">{t("dash.open")}<ChevronRight size={16} aria-hidden="true" /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const BENEFITS = [
  { icon: ChartNoAxesCombined, title: "dash.benefit1Title", text: "dash.benefit1Text" },
  { icon: Sprout, title: "dash.benefit2Title", text: "dash.benefit2Text" },
  { icon: BookOpenCheck, title: "dash.benefit3Title", text: "dash.benefit3Text" },
  { icon: CircleCheckBig, title: "dash.benefit4Title", text: "dash.benefit4Text" },
];

export default function Dashboard() {
  const t = useT();
  const { user } = useAuth();
  const summary = useAsync(() => historyService.summary(), []);
  const [intro] = useState(() => { try { return !sessionStorage.getItem(HERO_SEEN_KEY); } catch { return false; } });
  useEffect(() => { try { sessionStorage.setItem(HERO_SEEN_KEY, "1"); } catch { /* storage unavailable */ } }, []);
  const now = new Date();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const greeting = t(greetingKey(now.getHours()));
  const today = fmtDate(now.toISOString(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const s = summary.data;

  return (
    <>
      <section className={`home-hero${intro ? " hero-intro" : ""}`} aria-labelledby="dash-title">
        <div className="home-hero-copy">
          <p className="home-hero-hello">
            <span>{firstName ? `${greeting}, ${firstName}` : greeting}</span>
            <span className="dash-date"><CalendarDays size={15} aria-hidden="true" /><time dateTime={now.toISOString().slice(0, 10)}>{today}</time></span>
          </p>
          <p className="home-hero-label">{t("dash.heroLabel")}</p>
          <h1 id="dash-title">{t("dash.heroTitle")}</h1>
          <p className="home-hero-text">{t("dash.heroText")}</p>
          <div className="home-hero-actions">
            <Link to="/price-prediction" className="btn btn-primary btn-lg"><ChartNoAxesCombined size={19} aria-hidden="true" />{t("dash.heroCtaPrice")}</Link>
            <Link to="/crop-recommendation" className="btn btn-harvest btn-lg"><Sprout size={19} aria-hidden="true" />{t("dash.heroCtaCrop")}</Link>
          </div>
          <p className="home-hero-note"><Info size={15} aria-hidden="true" />{t("dash.heroNote")}</p>
          <button type="button" className="btn-link tour-restart" onClick={startTour}><Compass size={16} aria-hidden="true" />{t("tour.restart")}</button>
        </div>
        <div className="home-hero-media">
          <span className="hero-shape hero-shape-leaf" aria-hidden="true" />
          <span className="hero-shape hero-shape-sun" aria-hidden="true" />
          <div className="home-hero-photo">
            <img src={heroPhoto} alt={t("art.farmerAlt")} width="960" height="1080" decoding="async" />
          </div>
        </div>
      </section>

      <Tip id="dashboard" className="mt-4">{t("tip.dashboard")}</Tip>

      <section className="section" aria-labelledby="recent-title">
        <div className="dash-section-head">
          <h2 id="recent-title" className="section-heading">{t("dash.recentTitle")}</h2>
          <Link to="/history" className="inline-icon font-semibold"><History size={17} aria-hidden="true" />{t("dash.viewAll")}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <p className="muted small !mt-0 !mb-3">{t("dash.savedNote")}</p>
        {summary.error ? (
          <Alert type="error" action={<button className="btn btn-secondary" onClick={summary.reload}>{t("common.retry")}</button>}>{summary.error}</Alert>
        ) : !s ? (
          <div className="recent-grid" aria-busy="true" aria-label={t("dash.loading")}>
            {[0, 1].map((i) => <div key={i} className="card"><span className="skeleton" style={{ height: 18, width: "45%" }} />
              <span className="skeleton mt-3" style={{ height: 56 }} /><span className="skeleton mt-2" style={{ height: 56 }} /></div>)}
          </div>
        ) : (
          <div className="recent-grid">
            <RecentPrices items={s.recent_predictions} total={s.total_price_predictions} />
            <RecentCrops items={s.recent_recommendations} total={s.total_crop_recommendations} />
          </div>
        )}
      </section>

      <section className="section benefits" aria-labelledby="benefits-title">
        <h2 id="benefits-title" className="section-heading">{t("dash.benefitsTitle")}</h2>
        <ul className="benefit-list">
          {BENEFITS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="reveal" style={{ "--i": i }}>
              <span className="benefit-icon" aria-hidden="true"><Icon size={20} /></span>
              <span><strong>{t(title)}</strong><span>{t(text)}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
