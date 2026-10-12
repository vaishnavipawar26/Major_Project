import { useT } from "../i18n/LanguageContext";

/** Chart heading plus a one- or two-sentence explanation of what the chart shows. */
export default function ChartIntro({ title, icon: Icon, children, as: Heading = "h3" }) {
  return (
    <div className="chart-intro">
      <Heading className="section-title">{Icon && <Icon size={18} aria-hidden="true" />}{title}</Heading>
      {children && <p className="chart-desc">{children}</p>}
    </div>
  );
}

/** Plain-text reading of a chart, so its message is available without looking at the graph. */
export function ChartSummary({ children }) {
  const t = useT();
  return <p className="chart-summary"><strong>{t("chart.inShort")}</strong> {children}</p>;
}
