import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { createApi } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { AdminPage } from "./pages/admin";
import { DayPage } from "./pages/day";
import { DaysPage } from "./pages/days";
import { HistoryPage } from "./pages/history";
import { ReportPage } from "./pages/report";
import { RunsPage, RunsRedirect } from "./pages/runs";
import { SignInPage } from "./pages/signin";
import { CallbackPage } from "./pages/callback";
import { ApiProvider } from "./providers";
import { Shell } from "./shell";

export function App() {
  return (
    <AuthProvider>
      <AuthedApp />
    </AuthProvider>
  );
}

function AuthedApp() {
  const auth = useAuth();
  const api = useMemo(() => createApi(() => auth.getAccessToken()), [auth.getAccessToken]);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <ApiProvider api={api}>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <Routes>
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Shell />}>
                <Route path="/" element={<DaysPage />} />
                <Route path="/d/:date" element={<DayPage />} />
                <Route path="/r/:asset/:date" element={<ReportPage />} />
                <Route path="/a/:asset" element={<HistoryPage />} />
                <Route path="/runs" element={<RunsRedirect />} />
                <Route path="/runs/:date" element={<RunsPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ApiProvider>
  );
}

function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.ready) return <div className="boot" aria-busy="true" />;
  if (!auth.user) return <SignInPage key={`${location.pathname}${location.search}`} />;
  return <Outlet />;
}
