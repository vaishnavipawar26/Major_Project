import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Info, Leaf } from "lucide-react";
import { LogoMark } from "./Logo";
import { useT } from "../i18n/LanguageContext";

const LINKS = [
  { to: "/price-prediction", label: "nav.price" },
  { to: "/crop-recommendation", label: "nav.crop" },
  { to: "/history", label: "nav.history" },
];

/** Dark-green end-of-page panel that shares the sidebar colour. */
export default function Footer() {
  const t = useT();
  // the price form keeps its footer to links only: the forecast caveat belongs on the result page
  const showNote = useLocation().pathname !== "/price-prediction";
  return (
    <footer className="app-footer">
      <svg className="footer-pattern" viewBox="0 0 320 240" aria-hidden="true" focusable="false">
        <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M40 240C38 190 46 150 80 104M80 104c-2-26 10-46 34-58M80 104c-26-6-38-26-34-52" />
          <path d="M130 240c-2-60 8-110 46-160M176 80c0-30 14-52 40-64M176 80c-28-8-40-30-36-58" />
          <path d="M226 240c-2-50 6-92 36-132M262 108c0-24 12-40 34-50M262 108c-22-6-32-22-30-42" />
        </g>
        <g fill="#fff"><ellipse cx="114" cy="46" rx="14" ry="7" transform="rotate(-35 114 46)" /><ellipse cx="216" cy="16" rx="14" ry="7" transform="rotate(-35 216 16)" /><ellipse cx="296" cy="58" rx="13" ry="6" transform="rotate(-35 296 58)" /></g>
      </svg>

      <div className="content footer-grid">
        <div className="footer-brand">
          <span className="footer-logo"><LogoMark size={34} /><strong>SmartCrop <span>AI</span></strong></span>
          <p>{t("footer.tagline")}</p>
        </div>

        <nav className="footer-col" aria-label={t("footer.nav")}>
          <h2 className="footer-heading">{t("footer.quick")}</h2>
          <ul className="footer-links">
            {LINKS.map(({ to, label }) => (
              <li key={to}><Link to={to}><span>{t(label)}</span><ArrowRight size={14} aria-hidden="true" /></Link></li>
            ))}
          </ul>
        </nav>

        {showNote && (
          <div className="footer-col">
            <h2 className="footer-heading">{t("footer.good")}</h2>
            <p className="footer-note"><Info size={18} aria-hidden="true" /><span>{t("footer.disclaimer")}</span></p>
          </div>
        )}
      </div>

      <div className="content footer-meta">
        <span>&copy; {new Date().getFullYear()} SmartCrop AI</span>
        <span className="footer-made"><Leaf size={14} aria-hidden="true" />{t("footer.made")}</span>
      </div>
    </footer>
  );
}
