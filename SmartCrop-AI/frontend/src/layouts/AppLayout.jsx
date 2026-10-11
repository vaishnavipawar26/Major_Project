import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ChartNoAxesCombined, History, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Sprout, UserRound, X,
} from "lucide-react";
import Footer from "../components/Footer";
import { useAuth } from "../hooks/useAuth";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/price-prediction", label: "Price Prediction", icon: ChartNoAxesCombined },
  { to: "/crop-recommendation", label: "Crop Recommendation", icon: Sprout },
  { to: "/history", label: "History", icon: History },
  { to: "/profile", label: "Profile", icon: UserRound },
];

const COLLAPSED_KEY = "smartcrop_sidebar_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } };

function Brand({ compact = false }) {
  return (
    <Link to="/dashboard" className="brand" aria-label="SmartCrop AI — dashboard">
      <span className="brand-mark" aria-hidden="true"><Sprout size={18} /></span>
      {!compact && <span className="brand-text">SmartCrop <span>AI</span></span>}
    </Link>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);              // mobile drawer
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop icon-only rail

  useEffect(() => setOpen(false), [location.pathname]);

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
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open navigation"
          aria-expanded={open} aria-controls="sidebar">
          <Menu size={20} />
        </button>
        <Brand />
      </header>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside id="sidebar" className={`sidebar${open ? " open" : ""}`} aria-label="Sidebar">
        <div className="sidebar-head">
          <Brand compact={rail} />
          <button type="button" className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <nav className="nav" aria-label="Main">
          {!rail && <span className="nav-label">Menu</span>}
          {LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} data-tooltip={rail ? label : undefined} aria-label={rail ? label : undefined}>
              <Icon size={18} aria-hidden="true" />
              {!rail && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user && !rail && (
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{initials}</span>
              <span className="user-meta"><strong>{user.name}</strong><span>{user.email}</span></span>
            </div>
          )}
          <button type="button" className="nav-item" onClick={handleLogout}
            data-tooltip={rail ? "Logout" : undefined} aria-label={rail ? "Logout" : undefined}>
            <LogOut size={18} aria-hidden="true" />
            {!rail && <span>Logout</span>}
          </button>
          <button type="button" className="nav-item collapse-toggle" onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-tooltip={rail ? "Expand sidebar" : undefined}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            {!rail && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="main-col">
        <main className="main" id="main-content">
          <div className="content">
            <Outlet />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
