import { Link, useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useT } from "../i18n/LanguageContext";

export default function NotFound() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <EmptyState icon={Compass} title={t("notfound.title")}
      action={(
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" to="/dashboard">{t("notfound.home")}</Link>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>{t("notfound.back")}</button>
        </div>
      )}>
      {t("notfound.body")}
    </EmptyState>
  );
}
