import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpenCheck, CalendarDays, ChartNoAxesCombined, ChevronRight, CircleCheckBig, History, Leaf, PlayCircle, Sprout,
  TrendingUp, UserRound,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import DirectionBadge from "../components/DirectionBadge";
import { startTour } from "../components/GuidedTour";
import Tip from "../components/Tip";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n/LanguageContext";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import { addDays, compactRupees, cropName, fmtDate, monthLabel, monthShort, rupees, titleCase, topCrops } from "../utils/format";
import { isAboutSame, isContextOnly, latestText } from "../utils/priceView";
import heroPhoto from "../assets/photos/hero-farmer.webp";

const RECENT = 3;
const HERO_SEEN_KEY = "smartcrop_hero_seen"; // the hero intro animation plays once per browser session

function greetingKey(hour) {
  if (hour < 12) return "dash.morning";
  if (hour < 17) return "dash.afternoon";
  return "dash.evening";
}

/** "Smarter Crop Decisions, Better Market Insights" -> two lines at the first comma (one line if there is none). */
function splitTitle(title) {
  const m = title.match(/^(.*?[,，])\s*(.+)$/);
  return m ? [m[1], m[2]] : [title];
}

/** "2026-11" + k months -> "2027-02" */
function addMonths(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Expected harvest window from the saved planting month and the crop's growth period in the cropping calendar. */
function harvestWindow(plantingDate, cal) {
  if (!plantingDate || !cal) return null;
  const a = addMonths(plantingDate, cal.growth_months_min), b = addMonths(plantingDate, cal.growth_months_max);
  return a === b ? monthLabel(a) : `${monthLabel(a)} – ${monthLabel(b)}`;
}

/** Tiny line of a saved forecast: starting price followed by the saved daily predictions (decorative; numbers are shown as text). */
function Sparkline({ start, path }) {
  const values = [start, ...path.map((p) => p.predicted_price)].filter((v) => v != null);
  if (values.length < 2) return null;
  const w = 80, h = 28, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - lo) / span) * (h - 6)}`).join(" ");
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="var(--series-forecast)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function CardHead({ icon: Icon, id, title, total }) {
  return (
    <div className="recent-head">
      <h3 id={id} className="section-title"><Icon size={18} aria-hidden="true" />{title}</h3>
      <span className="count-chip">{total}</span>
    </div>
  );
}

function RecentPrices({ items, total }) {
  const t = useT();
  return (
    <section className="card recent-card reveal" aria-labelledby="recent-prices">
      <CardHead icon={ChartNoAxesCombined} id="recent-prices" title={t("dash.recentPrices")} total={total} />
      {items.length === 0 ? (
        <div className="recent-empty">
          <p className="muted">{t("dash.noPrices")}</p>
          <Link to="/price-prediction" className="btn btn-primary">{t("dash.checkPrice")}</Link>
        </div>
      ) : (
        <ul className="recent-list">
          {items.slice(0, RECENT).map((p) => (
            <li key={p.id}>
              <Link to={`/price-prediction/result?id=${p.id}`} className="recent-item">
                <CropArt crop={p.commodity} size={48} className="recent-art" decorative />
                <span className="recent-main">
                  <strong>{cropName(t, p.commodity)}</strong>
                  <span className="muted small">{p.market === "All markets (state median)" ? t("price.form.allMarkets") : p.market} · {t("dash.savedOn", { date: fmtDate(p.created_at) })}</span>
                  <span className="recent-value">{isContextOnly(p)
                    ? (latestText(t, p.latest_recorded) ?? t("price.result.noDirectionNoPrice"))
                    : isAboutSame(p) ? t("dash.aboutSame", { price: rupees(p.verdict.start_price), estimate: rupees(p.verdict.model_estimate) })
                    : t("dash.expectedOn", { price: rupees(p.predicted_price), date: fmtDate(addDays(p.input_date, p.horizon_days)) })}</span>
                </span>
                <span className="recent-side">
                  {!isContextOnly(p) && !isAboutSame(p) && <Sparkline start={p.current_price} path={p.future_trend || []} />}
                  {!isContextOnly(p) && !isAboutSame(p) && <DirectionBadge direction={p.predicted_direction} />}
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

function Metric({ label, value }) {
  return (
    <div className="plan-metric">
      <span className="plan-metric-label">{label}</span>
      <strong className="plan-metric-value num">{value}</strong>
    </div>
  );
}

/** The most recent saved crop plan with its key numbers (all read from the saved result). */
function RecentCrops({ items, total, calendar }) {
  const t = useT();
  const r = items[0];
  const best = r && topCrops(r.results)[0];
  const crop = best && titleCase(best.crop_name);
  const harvest = best && harvestWindow(r.planting_date, calendar?.[crop]);
  return (
    <section className="card recent-card reveal" style={{ "--i": 1 }} aria-labelledby="recent-crops">
      <CardHead icon={Sprout} id="recent-crops" title={t("dash.recentCrops")} total={total} />
      {!r ? (
        <div className="recent-empty">
          <p className="muted">{t("dash.noCrops")}</p>
          <Link to="/crop-recommendation" className="btn btn-primary">{t("dash.findCrop")}</Link>
        </div>
      ) : (
        <Link to={`/crop-recommendation/result?id=${r.id}`} className="plan-card">
          <span className="plan-card-head">
            <CropArt crop={crop} size={64} className="recent-art" decorative />
            <span className="recent-main">
              <strong className="plan-card-name">{best ? cropName(t, crop) : t("hist.noneSuitable")}</strong>
              <span className="muted small">
                {r.city ? `${cropName(t, r.city, "city")} · ` : ""}{monthShort(r.month)}{r.selling_month ? ` → ${monthShort(r.selling_month)}` : ""}
                {r.area_acres ? ` · ${fieldSizeText(t, r.area_acres)}` : ""}
              </span>
              <span className="muted small">{t("dash.savedOn", { date: fmtDate(r.created_at) })}</span>
            </span>
          </span>
          {best && (
            <span className="plan-metrics">
              {best.recommendation_score != null && <Metric label={t("dash.metricScore")} value={`${Math.round(best.recommendation_score)}/100`} />}
              {best.expected_profit != null && <Metric label={t("dash.metricProfit")} value={compactRupees(best.expected_profit)} />}
              {best.predicted_price != null && <Metric label={t("dash.metricPrice")} value={`${rupees(best.predicted_price)}`} />}
              {harvest && <Metric label={t("dash.metricHarvest")} value={harvest} />}
            </span>
          )}
          <span className="plan-card-open">{t("dash.openPlan")}<ArrowRight size={16} aria-hidden="true" /></span>
        </Link>
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
  // crop calendar for the harvest window; the dashboard works without it (the harvest metric is then left out)
  const options = useAsync(() => cropService.options(), []);
  const [intro] = useState(() => { try { return !sessionStorage.getItem(HERO_SEEN_KEY); } catch { return false; } });
  useEffect(() => { try { sessionStorage.setItem(HERO_SEEN_KEY, "1"); } catch { /* storage unavailable */ } }, []);
  const now = new Date();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const greeting = t(greetingKey(now.getHours()));
  const today = fmtDate(now.toISOString(), { weekday: "long", day: "numeric", month: "short", year: "numeric" });
  const titleLines = splitTitle(t("dash.heroTitle"));
  const s = summary.data;

  return (
    <>
      <section className={`home-hero hero-v2${intro ? " hero-intro" : ""}`} aria-labelledby="dash-title">
        <svg className="hero-grass" viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="grass-fade" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#6fae6a" stopOpacity="0.38" />
              <stop offset="1" stopColor="#6fae6a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path fill="url(#grass-fade)" d="M0 120V70l10 26 6-44 10 40 8-52 9 50 7-36 10 34 8-58 9 56 8-30 9 36 9-48 8 44 9-28 9 34 8-40 9 34 9-22 10 26 8-32 9 30 8-16 9 20 8-24 9 22 10-10 8 16V120z" />
        </svg>
        <div className="home-hero-copy">
          <div className="hero-chips">
            <span className="hero-chip"><UserRound size={16} aria-hidden="true" />{firstName ? `${greeting}, ${firstName}` : greeting}</span>
            <span className="hero-chip"><CalendarDays size={16} aria-hidden="true" /><time dateTime={now.toISOString().slice(0, 10)}>{today}</time></span>
          </div>
          <h1 id="dash-title">{titleLines.map((line, i) => <span key={i} className="hero-line">{line}</span>)}</h1>
          <p className="home-hero-text">{t("dash.heroText")}</p>
          <div className="home-hero-actions">
            <Link to="/price-prediction" className="btn btn-lg hv2-btn hv2-green"><TrendingUp size={19} aria-hidden="true" />{t("dash.heroCtaPrice")}</Link>
            <Link to="/crop-recommendation" className="btn btn-lg hv2-btn hv2-amber"><Sprout size={19} aria-hidden="true" />{t("dash.heroCtaCrop")}</Link>
          </div>
          <button type="button" className="hv2-tour" onClick={startTour}><PlayCircle size={19} aria-hidden="true" />{t("tour.restart")}</button>
        </div>
        <svg className="hero-leaf" viewBox="0 0 120 160" aria-hidden="true" focusable="false">
          <path d="M60 156C58 110 62 60 96 8 100 60 98 118 60 156z" fill="#5c9a62" />
          <path d="M60 156C60 112 66 66 94 16" fill="none" stroke="#f4f8ee" strokeWidth="2" strokeLinecap="round" />
          <path d="M58 120C36 112 18 92 10 62 38 66 54 88 58 120z" fill="#7fb283" />
        </svg>
        <div className="home-hero-media">
          <div className="home-hero-photo">
            {/* swap the picture by replacing src/heroPhoto above */}
            <img src={heroPhoto} alt={t("art.farmerAlt")} width="960" height="1080" decoding="async" />
            <p className="hero-script" aria-hidden="true">
              <span>{t("dash.heroTagline")}</span>
              <svg viewBox="0 0 200 14" preserveAspectRatio="none"><path d="M3 9C40 2 90 2 130 7s50 3 67-2" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
            </p>
            <span className="hero-badge"><Leaf size={16} aria-hidden="true" />{t("dash.heroBadge")}</span>
          </div>
        </div>
      </section>

      <Tip id="dashboard" className="mb-4">{t("tip.dashboard")}</Tip>

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
            <RecentCrops items={s.recent_recommendations} total={s.total_crop_recommendations} calendar={options.data?.calendar} />
          </div>
        )}
      </section>

      <section className="section benefits" aria-labelledby="benefits-title">
        <h2 id="benefits-title" className="section-heading">{t("dash.benefitsTitle")}</h2>
        <ul className="benefit-list">
          {BENEFITS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="reveal" style={{ "--i": i }}>
              <span className="benefit-icon" aria-hidden="true"><Icon size={19} /></span>
              <span><strong>{t(title)}</strong><span>{t(text)}</span></span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
