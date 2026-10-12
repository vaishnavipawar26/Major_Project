import { useEffect } from "react";

/**
 * Soft ripple on the main action buttons (primary / harvest), added with one delegated listener so
 * no button component changes. Purely visual; it never prevents or delays the click. Skipped for
 * disabled buttons and when the user prefers reduced motion.
 */
export default function RippleManager() {
  useEffect(() => {
    const onDown = (e) => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const btn = e.target.closest?.(".btn-primary, .btn-harvest");
      if (!btn || btn.disabled) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.6;
      const span = document.createElement("span");
      span.className = "ripple";
      span.setAttribute("aria-hidden", "true");
      span.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      btn.appendChild(span);
      setTimeout(() => span.remove(), 600);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
