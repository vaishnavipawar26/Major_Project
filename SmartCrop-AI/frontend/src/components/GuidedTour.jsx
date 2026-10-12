import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n/LanguageContext";

/**
 * First-visit tour of the four main pages. It points at the existing navigation links (sidebar on
 * larger screens, bottom bar on phones) and never navigates or changes anything itself. The soft
 * overlay does not block the page. Whether it has been finished is remembered in this browser per
 * account (no backend or database change): finishing it, or skipping with "Don't show again"
 * checked, hides it for good; a plain skip hides it until the next browser session.
 * `startTour()` reopens it (the dashboard has a "Take a quick tour" button).
 */
const STEPS = [
  { target: "/dashboard", title: "tour.s1Title", text: "tour.s1Text" },
  { target: "/price-prediction", title: "tour.s2Title", text: "tour.s2Text" },
  { target: "/crop-recommendation", title: "tour.s3Title", text: "tour.s3Text" },
  { target: "/history", title: "tour.s4Title", text: "tour.s4Text" },
];
const START_EVENT = "smartcrop:tour-start";
const SKIP_KEY = "smartcrop_tour_skipped"; // sessionStorage: skipped for this session only
const doneKey = (user) => `smartcrop_tour_done_${user?.id ?? user?.email ?? "anon"}`;
const read = (store, k) => { try { return store.getItem(k); } catch { return null; } };
const write = (store, k, v) => { try { store.setItem(k, v); } catch { /* storage unavailable */ } };

export const startTour = () => window.dispatchEvent(new Event(START_EVENT));

/** The visible copy of a nav link (sidebar or phone bar), or null if none is on screen. */
function findTarget(path) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  return [...document.querySelectorAll(`[data-tour="${path}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
  }) || null;
}

/** Tooltip position next to the target: right of it if there is room, otherwise above or below. */
function place(r, box) {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight, gap = 14, m = 12;
  const w = Math.min(box.width || 320, vw - m * 2), h = box.height || 200;
  if (!r) return { left: (vw - w) / 2, top: Math.max(m, (vh - h) / 2), side: "none" };
  if (r.right + gap + w + m <= vw) {
    return { left: r.right + gap, top: Math.min(Math.max(m, r.top + r.height / 2 - h / 2), vh - h - m), side: "right" };
  }
  const left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), vw - w - m);
  if (r.top > vh / 2) return { left, top: Math.max(m, r.top - gap - h), side: "top" };
  return { left, top: Math.min(r.bottom + gap, vh - h - m), side: "bottom" };
}

export default function GuidedTour() {
  const t = useT();
  const { user } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState(-1); // -1 = closed
  const [never, setNever] = useState(false);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);
  const nextRef = useRef(null);
  const open = step >= 0;

  // first visit: open once on the dashboard, after the page has settled
  useEffect(() => {
    if (!user || location.pathname !== "/dashboard") return undefined;
    if (read(localStorage, doneKey(user)) || read(sessionStorage, SKIP_KEY)) return undefined;
    const id = setTimeout(() => setStep((s) => (s < 0 ? 0 : s)), 1200);
    return () => clearTimeout(id);
  }, [user, location.pathname]);

  useEffect(() => {
    const onStart = () => { setNever(false); setStep(0); };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  const close = useCallback((finished) => {
    if (finished || never) write(localStorage, doneKey(user), "1");
    else write(sessionStorage, SKIP_KEY, "1");
    setStep(-1);
  }, [never, user]);

  // follow the target while open (resizing, scrolling, sidebar collapsing)
  const measure = useCallback(() => {
    if (step < 0) return;
    const el = findTarget(STEPS[step].target);
    const r = el ? el.getBoundingClientRect() : null;
    setRect(r);
    setPos(place(r, boxRef.current?.getBoundingClientRect() || {}));
  }, [step]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    if (!open) return undefined;
    const id = requestAnimationFrame(measure); // again once the tooltip has its real size
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, measure]);

  useEffect(() => { if (open) nextRef.current?.focus({ preventScroll: true }); }, [open, step]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const pad = 6;
  return (
    <div className="tour">
      {rect
        ? <div className="tour-spot" aria-hidden="true"
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" aria-hidden="true" />}
      <div ref={boxRef} className={`tour-box side-${pos?.side || "none"}`} role="dialog" aria-modal="false"
        aria-labelledby="tour-title" aria-describedby="tour-text"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}>
        <div className="tour-head">
          <span className="tour-progress">{t("tour.progress", { n: step + 1, total: STEPS.length })}</span>
          <button type="button" className="tour-x" onClick={() => close(false)} aria-label={t("tour.close")}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((x, i) => <span key={x.target} className={i <= step ? "on" : ""} />)}
        </div>
        <h2 id="tour-title" className="tour-title">{t(s.title)}</h2>
        <p id="tour-text" className="tour-text">{t(s.text)}</p>
        <label className="tour-never">
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />{t("tour.dontShow")}
        </label>
        <div className="tour-actions">
          <button type="button" className="btn-link" onClick={() => close(false)}>{t("tour.skip")}</button>
          <span className="tour-nav">
            {step > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} aria-hidden="true" />{t("tour.back")}
              </button>
            )}
            <button ref={nextRef} type="button" className="btn btn-primary btn-sm" onClick={() => (last ? close(true) : setStep(step + 1))}>
              {last ? t("tour.finish") : <>{t("tour.next")}<ArrowRight size={16} aria-hidden="true" /></>}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
