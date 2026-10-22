import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { completeSignIn } from "../auth";
import { isDemoMode } from "../config";

export function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isDemoMode()) {
      navigate("/", { replace: true });
      return;
    }
    let cancelled = false;
    completeSignIn()
      .then((dest) => {
        if (!cancelled) navigate(dest, { replace: true });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Sign-in failed");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  return (
    <main className="signin">
      <section className="signin-card">
        <p className="brand-kicker">FX CHART ANALYST</p>
        <h1>{error ? "Sign-in failed" : "Signing in"}</h1>
        {error ? <p className="form-error">{error}</p> : <p className="muted">Completing the Cognito callback.</p>}
      </section>
    </main>
  );
}
