import { useLocation } from "react-router-dom";
import { isDemoMode } from "../config";
import { useAuth } from "../auth";

export function SignInPage() {
  const auth = useAuth();
  const location = useLocation();
  return (
    <main className="signin">
      <section className="signin-card">
        <p className="brand-kicker">FX CHART ANALYST</p>
        <h1>Nasdaq 100 · Gold</h1>
        <p className="muted">Weekday runs at 09:00 SAST. Sign in to read the morning analysis.</p>
        <button className="btn btn-primary" type="button" disabled={auth.busy} onClick={() => void auth.signIn(`${location.pathname}${location.search}`)}>
          {auth.busy ? "Redirecting…" : "Sign in"}
        </button>
        {isDemoMode() ? <p className="hint">Demo mode — sample October 2026 analyses. No password.</p> : null}
        {auth.error ? (
          <p className="form-error" role="alert">
            {auth.error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
