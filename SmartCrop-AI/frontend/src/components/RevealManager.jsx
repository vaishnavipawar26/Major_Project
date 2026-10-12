import { useEffect } from "react";

/**
 * Scroll-reveal without a package: elements with the `reveal` class fade up once when they enter
 * the viewport (CSS in index.css; optional stagger via the `--i` custom property).
 * Content is hidden only while this observer runs (`html.reveal-ready`), so with reduced motion,
 * JavaScript off or no IntersectionObserver everything is simply shown. Each element is revealed
 * once and then left alone, so later re-renders never replay the animation.
 */
export default function RevealManager() {
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) return undefined;
    const root = document.documentElement;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -5% 0px", threshold: 0.04 });
    const watched = new WeakSet();
    const scan = () => document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => {
      if (!watched.has(el)) { watched.add(el); io.observe(el); }
    });
    // Safety net: anything already scrolled past (e.g. after the End key or a jump link) is shown at
    // once, so no content can stay hidden just because it never "entered" the viewport gradually.
    let frame = 0;
    const revealPassed = () => {
      frame = 0;
      document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add("is-visible"); io.unobserve(el); }
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(revealPassed); };
    root.classList.add("reveal-ready");
    scan();
    const mo = new MutationObserver(scan); // results and history arrive after their API calls
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Backstop that does not depend on rendering frames (scroll events and observers need them):
    // a cheap check of the few remaining hidden elements a few times per second.
    const timer = setInterval(() => { if (document.querySelector(".reveal:not(.is-visible)")) revealPassed(); }, 300);
    return () => {
      clearInterval(timer);
      mo.disconnect(); io.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll);
      root.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}
