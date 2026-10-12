import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import PasswordInput from "../components/PasswordInput";
import { useToast } from "../components/Toast";
import SproutSpinner from "../components/SproutSpinner";
import { useAuth } from "../hooks/useAuth";
import { useKnownMessage, useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { isEmail } from "../utils/validation";

export default function Login() {
  const t = useT();
  const known = useKnownMessage();
  const { login } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!isEmail(form.email)) errs.email = t("auth.errEmail");
    if (!form.password) errs.password = t("auth.errPassword");
    setErrors(errs);
    if (Object.keys(errs).length) { document.getElementById(errs.email ? "email" : "password")?.focus(); return; }
    setSubmitting(true);
    setApiError(null);
    try {
      const u = await login(form.email.trim(), form.password);
      // only reached after the server accepted the login (a failure throws and goes to the catch below)
      notify({ type: "success", celebrate: "login", title: t("toast.loginTitle"), message: t("toast.loginBody", { name: u?.name?.trim().split(/\s+/)[0] || "" }) });
      navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card auth-card stack" onSubmit={submit} noValidate aria-busy={submitting}>
      <div>
        <h1 className="auth-title">{t("auth.loginTitle")}</h1>
        <p className="text-2 !mb-0">{t("auth.loginSubtitle")}</p>
      </div>
      {apiError && <Alert type="error">{known(apiError)}</Alert>}
      <FormField id="email" label={t("auth.email")} error={errors.email}>
        <input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </FormField>
      <FormField id="password" label={t("auth.password")} error={errors.password}>
        <PasswordInput id="password" autoComplete="current-password" value={form.password} onChange={set("password")} />
      </FormField>
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        {submitting && <SproutSpinner inButton />}{submitting ? t("auth.loggingIn") : t("auth.loginButton")}
      </button>
      <p className="small text-2 auth-switch">
        {t("auth.newHere")} <Link to="/register">{t("auth.createAccount")}</Link>
      </p>
    </form>
  );
}
