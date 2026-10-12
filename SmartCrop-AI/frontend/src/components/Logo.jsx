import { useId } from "react";

/**
 * SmartCrop AI mark: a sprout rising from field rows with a harvest sun, on a deep-green tile.
 * Pure SVG so it stays sharp at 18px (mobile header) and at 44px (sign-in page). Decorative:
 * the brand name is always shown as text or given as the link's accessible name.
 */
export function LogoMark({ size = 34, className = "" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`logo-mark ${className}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2F855A" />
          <stop offset="1" stopColor="#174D35" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#lg-${id})`} />
      <circle cx="30.5" cy="10" r="4" fill="#F2C14E" />
      {/* field rows */}
      <path d="M4 31c7-4 25-4 32 0" fill="none" stroke="#9fdcb0" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <path d="M8 35.5c6-2.6 18-2.6 24 0" fill="none" stroke="#9fdcb0" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      {/* sprout */}
      <path d="M20 30V17" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M20 22c-1-4.6-4.6-7-9.2-6.6.2 4.8 3.8 7.4 9.2 6.6z" fill="#cfeedb" />
      <path d="M20 19c.6-5.8 4.6-9 10-8.6-.2 5.8-4.2 9-10 8.6z" fill="#fff" />
    </svg>
  );
}

/** Mark + "SmartCrop AI" wordmark (the text can be hidden for the collapsed sidebar). */
export default function Logo({ size = 34, showText = true, className = "" }) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark size={size} />
      {showText && <span className="brand-text">SmartCrop <span>AI</span></span>}
    </span>
  );
}
