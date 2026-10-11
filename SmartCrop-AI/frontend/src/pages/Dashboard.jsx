import { Link } from "react-router-dom";
import {
  ArrowRight, CalendarDays, CalendarRange, ChartNoAxesCombined, History, Leaf, Sprout, TrendingUp,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const FEATURES = [
  {
    to: "/price-prediction", icon: ChartNoAxesCombined, title: "Crop Price Prediction",
    text: "Forecast future mandi prices and explore potential selling opportunities.", cta: "Predict Crop Price",
  },
  {
    to: "/crop-recommendation", icon: Sprout, title: "Profitable Crop Recommendation",
    text: "Discover suitable crops using available agricultural and environmental data.", cta: "Find Best Crop",
  },
  {
    to: "/history", icon: History, title: "Prediction History",
    text: "Access your saved price forecasts and crop recommendations.", cta: "View History",
  },
];

// Each tile opens the existing page that provides it: selling-date comparison is part of the
// price forecast result (best time to sell + daily forecast chart), suitability is part of the
// crop recommendation.
const TOOLKIT = [
  { to: "/price-prediction", icon: TrendingUp, label: "Forecast Crop Prices", hint: "Daily mandi forecasts up to 60 days" },
  { to: "/price-prediction", icon: CalendarRange, label: "Compare Selling Dates", hint: "Best time to sell, with storage limits" },
  { to: "/crop-recommendation", icon: Leaf, label: "Explore Crop Suitability", hint: "Soil, weather and timing fit" },
];

function greeting(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Decorative field-and-growth illustration for the hero (pure SVG, no external assets, no data). */
function FieldIllustration() {
  const sprouts = [[70, 168, 1], [118, 176, 1.15], [170, 170, 0.95], [222, 178, 1.1], [272, 171, 1]];
  return (
    <svg className="hero-art" viewBox="0 0 340 220" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hero-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe8a3" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffe8a3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hero-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5fb67c" />
          <stop offset="1" stopColor="#2f7d4a" />
        </linearGradient>
      </defs>
      <circle cx="262" cy="58" r="52" fill="url(#hero-sun)" />
      <circle cx="262" cy="58" r="20" fill="#ffe08a" />
      {/* rising growth line — decorative, not data */}
      <path d="M24 112 C 70 104, 92 84, 132 88 S 196 58, 232 62 S 286 30, 316 26" fill="none"
        stroke="#d9f2e1" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 7" />
      {[[132, 88], [232, 62], [316, 26]].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="4.5" fill="#123d24" stroke="#d9f2e1" strokeWidth="2" />
      ))}
      <path d="M0 150 C 70 118, 150 122, 210 134 S 300 128, 340 116 L340 220 L0 220 Z" fill="#3c8d5a" opacity="0.55" />
      <path d="M0 168 C 80 146, 180 146, 340 160 L340 220 L0 220 Z" fill="url(#hero-field)" />
      {/* crop rows */}
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M-10 ${186 + i * 11} C 90 ${172 + i * 11}, 220 ${172 + i * 11}, 350 ${182 + i * 11}`}
          fill="none" stroke="#24683d" strokeWidth="2" opacity={0.55 - i * 0.08} />
      ))}
      {sprouts.map(([x, y, s]) => (
        <g key={x} transform={`translate(${x} ${y}) scale(${s})`}>
          <path d="M0 0 V-22" stroke="#cdeed7" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M0 -12 C -12 -14, -16 -24, -14 -30 C -6 -28, 0 -20, 0 -12 Z" fill="#a8e2bb" />
          <path d="M0 -16 C 10 -18, 16 -28, 15 -34 C 6 -32, 0 -24, 0 -16 Z" fill="#cdeed7" />
        </g>
      ))}
    </svg>
  );
}

function FeatureCard({ to, icon: Icon, title, text, cta }) {
  return (
    <Link to={to} className="feature-card">
      <span className="feature-icon" aria-hidden="true"><Icon size={26} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      <span className="feature-cta">
        {cta}
        <span className="feature-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
      </span>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const now = new Date();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const hello = firstName ? `${greeting(now.getHours())}, ${firstName}` : greeting(now.getHours());
  const today = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="hero-meta-row">
            <span className="hero-greeting">{hello}</span>
            <span className="hero-date">
              <CalendarDays size={15} aria-hidden="true" />
              <time dateTime={now.toISOString().slice(0, 10)}>{today}</time>
            </span>
          </div>
          <h1 id="hero-title">Smarter Farming Starts Here</h1>
          <p>AI-powered crop price forecasting and agricultural insights to support better farming decisions.</p>
          <div className="hero-actions">
            <Link to="/price-prediction" className="btn hero-btn-primary">
              Explore Price Prediction<ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link to="/crop-recommendation" className="btn hero-btn-secondary">
              <Sprout size={17} aria-hidden="true" />Find the Best Crop
            </Link>
          </div>
        </div>
        <FieldIllustration />
      </section>

      <section aria-labelledby="tools-title" className="section">
        <div className="section-head">
          <h2 id="tools-title">Main tools</h2>
          <p>Everything you need to plan, price and review your crops.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => <FeatureCard key={f.to} {...f} />)}
        </div>
      </section>

    </>
  );
}
