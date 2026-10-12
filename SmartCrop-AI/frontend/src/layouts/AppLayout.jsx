import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChartNoAxesCombined, History, House, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Sprout, UserRound, X,
} from "lucide-react";
import Footer from "../components/Footer";
import GuidedTour from "../components/GuidedTour";
import { LogoMark } from "../components/Logo";
import LanguageSwitcher from "../components/LanguageSwitcher";
import RevealManager from "../components/RevealManager";
import RippleManager from "../components/RippleManager";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n/LanguageContext";

// Same five routes as before; only the visible names changed. `short` is used in the phone bottom bar.
const LINKS = [
  { to: "/dashboard", label: "nav.dashboard", short: "nav.dashboardShort", icon: House },
  { to: "/price-prediction", label: "nav.price", short: "nav.priceShort", icon: ChartNoAxesCombined },
  { to: "/crop-recommendation", label: "nav.crop", short: "nav.cropShort", icon: Sprout },
  { to: "/history", label: "nav.history", short: "nav.historyShort", icon: History },
  { to: "/profile", label: "nav.profile", short: "nav.profileShort", icon: UserRound },
];
const BOTTOM = LINKS.slice(0, 4);

// Browser-tab title for each page (display only)
const TITLES = [
  ["/price-prediction/result", "title.priceResult"], ["/price-prediction", "title.price"],
  ["/crop-recommendation/result", "title.cropResult"], ["/crop-recommendation", "title.crop"],
  ["/history", "title.history"], ["/profile", "title.profile"], ["/dashboard", "title.dashboard"],
];

const COLLAPSED_KEY = "smartcrop_sidebar_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } };

function Brand({ compact = false }) {
  const t = useT();
  return (
    <Link to="/dashboard" className="brand" aria-label={t("nav.brandAria")}>
      <LogoMark size={34} />
      {!compact && <span className="brand-text">SmartCrop <span>AI</span></span>}
    </Link>
  );
}

export default function AppLayout() {
  const t = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);              // mobile drawer
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop icon-only rail

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const key = TITLES.find(([p]) => location.pathname.startsWith(p))?.[1];
    document.title = key ? `${t(key)} · SmartCrop AI` : "SmartCrop AI";
  }, [location.pathname, t]);

  // Close the mobile drawer with Escape and stop the page scrolling behind it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ }
    return !c;
  });

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const rail = collapsed && !open;
  const initials = (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      <RevealManager />
      <RippleManager />
      <GuidedTour />
      <a href="#main-content" className="skip-link">{t("nav.skip")}</a>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label={t("nav.open")}
          aria-expanded={open} aria-controls="sidebar">
          <Menu size={20} />
        </button>
        <Brand />
        <LanguageSwitcher className="topbar-lang" compact />
      </header>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside id="sidebar" className={`sidebar${open ? " open" : ""}`} aria-label={t("nav.sidebar")}>
        <div className="sidebar-head">
          <Brand compact={rail} />
          <button type="button" className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label={t("nav.close")}>
            <X size={20} />
          </button>
        </div>

        <nav className="nav" aria-label={t("nav.main")}>
          {!rail && <span className="nav-label">{t("nav.menu")}</span>}
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} data-tour={to} data-tooltip={rail ? t(label) : undefined} aria-label={rail ? t(label) : undefined}>
              <Icon size={19} aria-hidden="true" />
              {!rail && <span>{t(label)}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          {!rail && <LanguageSwitcher className="sidebar-lang" />}
          {user && !rail && (
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{initials}</span>
              <span className="user-meta"><strong>{user.name}</strong><span>{user.email}</span></span>
            </div>
          )}
          <button type="button" className="nav-item" onClick={handleLogout}
            data-tooltip={rail ? t("nav.logout") : undefined} aria-label={rail ? t("nav.logout") : undefined}>
            <LogOut size={18} aria-hidden="true" />
            {!rail && <span>{t("nav.logout")}</span>}
          </button>
          <button type="button" className="nav-item collapse-toggle" onClick={toggleCollapsed}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            data-tooltip={rail ? t("nav.expand") : undefined}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            {!rail && <span>{t("nav.collapseShort")}</span>}
          </button>
        </div>
      </aside>

      <div className="main-col">
        <main className="main" id="main-content" tabIndex={-1}>
          <div className="content">
            {/* replays a short CSS fade-in when the page changes; it does not delay rendering */}
            <div className="page-enter" key={location.pathname}><Outlet /></div>
          </div>
        </main>
        <Footer />
      </div>

      {/* phones: the four main pages stay one tap away */}
      <nav className="bottom-nav" aria-label={t("nav.quick")}>
        {BOTTOM.map(({ to, short, icon: Icon }) => (
          <NavLink key={to} to={to} data-tour={to}>
            <Icon size={21} aria-hidden="true" />
            <span>{t(short)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
