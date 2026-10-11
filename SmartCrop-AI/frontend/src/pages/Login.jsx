import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import { useAuth } from "../hooks/useAuth";
import { errorMessage } from "../services/api";
import { isEmail } from "../utils/validation";

export default function Login() {
  const { login } = useAuth();
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
    if (!isEmail(form.email)) errs.email = "Enter a valid email address.";
    if (!form.password) errs.password = "Enter your password.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    setApiError(null);
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div>
        <h2>Log in</h2>
        <p className="text-2">Welcome back. Log in to see your forecasts.</p>
      </div>
      {apiError && <Alert type="error">{apiError}</Alert>}
      <FormField id="email" label="Email" error={errors.email}>
        <input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password}>
        <input id="password" type="password" autoComplete="current-password" value={form.password}
          onChange={set("password")} />
      </FormField>
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </button>
      <p className="small text-2" style={{ margin: 0 }}>
        New here? <Link to="/register">Create an account</Link>
      </p>
    </form>
  );
}
