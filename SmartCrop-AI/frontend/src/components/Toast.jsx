import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useT } from "../i18n/LanguageContext";
import Celebration from "./Celebration";

/**
 * Small notification system (no package). `notify({ type, title, message })` shows a dismissible
 * toast (success, info, warning or error) that screen readers announce (polite for success/info,
 * assertive for warnings and errors). Success and info toasts close after a few seconds; warnings
 * and errors stay until the user closes them with the × button or the Escape key. The same message
 * is never stacked twice. It only shows what the caller reports — callers notify success only after
 * the server has confirmed it. Optional: `action: { label, to, onClick }` adds one button (a link
 * when `to` is given), and `celebrate: "login" | "register"` plays a short confetti burst.
 */
const ToastContext = createContext({ notify: () => {} });
const DURATION = { success: 4500, info: 5500 }; // warning / error: no auto-dismiss
const EXIT_MS = 180;
const ICONS = { info: Info, warning: TriangleAlert, error: CircleAlert };

function Check() {
  return (
    <svg className="toast-check" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle className="toast-check-circle" cx="12" cy="12" r="10.5" />
      <path className="toast-check-mark" d="M7 12.5l3.2 3.2L17 9" />
    </svg>
  );
}

function ToastItem({ toast, onClose }) {
  const t = useT();
  const ms = DURATION[toast.type] && (toast.action ? 9000 : DURATION[toast.type]); // more time to use the action
  useEffect(() => {
    if (!ms || toast.leaving) return undefined;
    const id = setTimeout(() => onClose(toast.id), ms);
    return () => clearTimeout(id);
  }, [toast, ms, onClose]);
  const Icon = ICONS[toast.type] || Info;
  const urgent = toast.type === "error" || toast.type === "warning";
  return (
    <div className={`toast toast-${toast.type}${toast.leaving ? " is-leaving" : ""}`} role={urgent ? "alert" : "status"}>
      <span className="toast-icon">{toast.type === "success" ? <Check /> : <Icon size={20} aria-hidden="true" />}</span>
      <div className="toast-body">
        {toast.title && <strong>{toast.title}</strong>}
        {toast.message && <span>{toast.message}</span>}
        {toast.action && (toast.action.to
          ? <Link to={toast.action.to} className="toast-action" onClick={() => { toast.action.onClick?.(); onClose(toast.id); }}>{toast.action.label}</Link>
          : <button type="button" className="toast-action" onClick={() => { toast.action.onClick?.(); onClose(toast.id); }}>{toast.action.label}</button>)}
      </div>
      <button type="button" className="toast-close" onClick={() => onClose(toast.id)} aria-label={t("toast.dismiss")}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const t = useT();
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const [burst, setBurst] = useState(null); // { kind, id } while a celebration plays
  const endBurst = useCallback(() => setBurst(null), []);
  // mark as leaving (exit animation), then remove
  const close = useCallback((id) => {
    setToasts((list) => list.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), EXIT_MS);
  }, []);
  const notify = useCallback(({ type = "info", title, message, action, celebrate }) => {
    seq.current += 1;
    const id = seq.current;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (celebrate && type === "success" && !calm) setBurst({ kind: celebrate, id });
    setToasts((list) => {
      // a repeat of a message already on screen replaces it instead of stacking a duplicate
      const rest = list.filter((x) => !(x.type === type && x.title === title && x.message === message));
      return [...rest.slice(-2), { id, type, title, message, action }]; // at most 3 on screen
    });
    return id;
  }, []);

  useEffect(() => {
    const open = toasts.filter((x) => !x.leaving);
    if (!open.length) return undefined;
    const onKey = (e) => { if (e.key === "Escape") close(open[open.length - 1].id); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toasts, close]);

  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {burst && <Celebration key={burst.id} kind={burst.kind} onDone={endBurst} />}
      <div className="toast-region" aria-label={t("toast.region")}>
        {toasts.map((x) => <ToastItem key={x.id} toast={x} onClose={close} />)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
