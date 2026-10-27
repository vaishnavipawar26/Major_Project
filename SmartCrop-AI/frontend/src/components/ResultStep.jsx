/** Numbered section of a result page: a small step number, a heading, then the content. */
export default function ResultStep({ n, id, title, subtitle, icon: Icon, className = "", children }) {
  return (
    <section className={`card result-step ${className}`} aria-labelledby={id}>
      <h2 id={id} className="step-title">
        <span className="step-num" aria-hidden="true">{n}</span>
        {Icon && <Icon size={19} aria-hidden="true" className="step-icon" />}
        <span>{title}</span>
      </h2>
      {subtitle && <p className="step-subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}
