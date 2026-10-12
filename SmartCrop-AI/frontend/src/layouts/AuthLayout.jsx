import { Outlet, useLocation } from "react-router-dom";
import { BrainCircuit, ChartNoAxesCombined, Sprout } from "lucide-react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import RippleManager from "../components/RippleManager";
import { LogoMark } from "../components/Logo";
import heroPhoto from "../assets/photos/hero-farmer.webp";
import { useT } from "../i18n/LanguageContext";

const POINTS = [
  { icon: ChartNoAxesCombined, text: "auth.point.price" },
  { icon: Sprout, text: "auth.point.crop" },
  { icon: BrainCircuit, text: "auth.point.explain" },
];

export default function AuthLayout() {
  const t = useT();
  const location = useLocation();
  return (
    <div className="auth-page">
      <RippleManager />
      <section className="auth-side" style={{ "--auth-photo": `url(${heroPhoto})` }}>
        <div className="brand auth-brand">
          <LogoMark size={44} />
          <span className="brand-text">SmartCrop <span>AI</span></span>
        </div>
        <p className="auth-lead">{t("auth.lead")}</p>
        <ul className="auth-points">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text}><span aria-hidden="true"><Icon size={18} /></span>{t(text)}</li>
          ))}
        </ul>
        <p className="small auth-note">{t("auth.note")}</p>
      </section>
      <section className="auth-form">
        <div className="auth-topbar"><LanguageSwitcher /></div>
        {/* on phones and tablets the side panel is hidden, so the brand and purpose stay visible here */}
        <div className="auth-mobile-brand">
          <div className="brand">
            <LogoMark size={40} />
            <span className="brand-text">SmartCrop <span>AI</span></span>
          </div>
          <p>{t("auth.leadShort")}</p>
        </div>
        <div className="page-enter auth-outlet" key={location.pathname}><Outlet /></div>
      </section>
    </div>
  );
}
