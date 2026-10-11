import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import { useAuth } from "../hooks/useAuth";
import { errorMessage } from "../services/api";
import { isEmail, validatePassword } from "../utils/validation";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = "Enter your name (at least 2 characters).";
    if (!isEmail(form.email)) errs.email = "Enter a valid email address.";
    const pw = validatePassword(form.password);
    if (pw) errs.password = pw;
    if (form.confirm !== form.password) errs.confirm = "Passwords do not match.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    setApiError(null);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div>
        <h2>Create your account</h2>
        <p className="text-2">Your forecasts and recommendations are saved privately to your account.</p>
      </div>
      {apiError && <Alert type="error">{apiError}</Alert>}
      <FormField id="name" label="Full name" error={errors.name}>
        <input id="name" autoComplete="name" value={form.name} onChange={set("name")} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email}>
        <input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
      </FormField>
      <FormField id="password" label="Password" hint="At least 8 characters, with a letter and a number."
        error={errors.password}>
        <input id="password" type="password" autoComplete="new-password" value={form.password}
          onChange={set("password")} />
      </FormField>
      <FormField id="confirm" label="Confirm password" error={errors.confirm}>
        <input id="confirm" type="password" autoComplete="new-password" value={form.confirm}
          onChange={set("confirm")} />
      </FormField>
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account"}
      </button>
      <p className="small text-2" style={{ margin: 0 }}>
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
