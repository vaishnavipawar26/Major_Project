import { Link } from "react-router-dom";
import { LogoMark } from "./Logo";
import { useT } from "../i18n/LanguageContext";

export default function Footer() {
  const t = useT();
  return (
    <footer className="app-footer">
      <div className="content footer-inner">
        <div className="footer-brand">
          <LogoMark size={30} />
          <div>
            <strong>SmartCrop AI</strong>
            <p>{t("footer.tagline")}</p>
          </div>
        </div>
        <nav className="footer-links" aria-label={t("footer.nav")}>
          <Link to="/price-prediction">{t("nav.price")}</Link>
          <Link to="/crop-recommendation">{t("nav.crop")}</Link>
          <Link to="/history">{t("nav.history")}</Link>
        </nav>
      </div>
      <div className="content footer-meta">
        <span>&copy; {new Date().getFullYear()} SmartCrop AI</span>
        <span>{t("footer.disclaimer")}</span>
      </div>
    </footer>
  );
}
