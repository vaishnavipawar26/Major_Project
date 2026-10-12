/**
 * Small growing-sprout loading indicator (replaces the plain ring spinner). The stem grows and
 * the two leaves unfold in a loop for as long as it is rendered — callers render it only while
 * a real request is pending. With reduced motion it is a still sprout. Decorative: the
 * surrounding text ("Signing you in…", etc.) is what screen readers announce.
 * `inButton` keeps the existing `btn-spinner` class used for the button loading state.
 */
export default function SproutSpinner({ inButton = false, size }) {
  return (
    <span className={`sprout-spinner${inButton ? " btn-spinner" : ""}`} aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" focusable="false">
        <path className="sprout-soil" d="M4 21.2h16" />
        <path className="sprout-stem" d="M12 21V10.5" />
        <path className="sprout-leaf sprout-leaf-l" d="M12 14.2C8.6 14.4 6.2 12.4 5.8 9.2c3.3-.2 5.7 1.7 6.2 5Z" />
        <path className="sprout-leaf sprout-leaf-r" d="M12 11.6c.3-3.4 2.6-5.6 6.2-5.8-.1 3.4-2.5 5.6-6.2 5.8Z" />
      </svg>
    </span>
  );
}
