import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DaySummary } from "@fx/core/api";
import { useAuth } from "./auth";
import { confidenceLabel, dayStatusLabel, directionArrow, directionLabel, gradeShort } from "./format";

type IconName = "calendar" | "trend" | "list" | "sliders" | "user" | "chevronLeft" | "chevronRight" | "share" | "close" | "info";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "calendar") {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
      </svg>
    );
  }
  if (name === "trend") {
    return (
      <svg {...common}>
        <path d="M3 17l6-6 4 3 8-8" />
        <path d="M15 6h6v6" />
      </svg>
    );
  }
  if (name === "list") {
    return (
      <svg {...common}>
        <path d="M9 6h12M9 12h12M9 18h12" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </svg>
    );
  }
  if (name === "sliders") {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
        <circle cx="8" cy="7" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="10" cy="17" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "user") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19.2c1.4-2.8 3.6-4.2 6.5-4.2s5.1 1.4 6.5 4.2" />
      </svg>
    );
  }
  if (name === "chevronLeft") return <svg {...common}><path d="M14.5 5.5 8 12l6.5 6.5" /></svg>;
  if (name === "chevronRight") return <svg {...common}><path d="M9.5 5.5 16 12l-6.5 6.5" /></svg>;
  if (name === "share") {
    return (
      <svg {...common}>
        <path d="M14 5h5v5" />
        <path d="M19 5 10.5 13.5" />
        <path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" />
      </svg>
    );
  }
  if (name === "info") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    );
  }
  return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

export function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 4.5V9h-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatusPill({ status }: { status: DaySummary["status"] | string }) {
  const known = status === "ok" || status === "partial" || status === "failed" || status === "running";
  const label = known ? dayStatusLabel(status) : status;
  const tone = known
    ? status
    : status.toLowerCase().includes("fail")
      ? "failed"
      : status.toLowerCase().includes("partial")
        ? "partial"
        : status.toLowerCase().includes("run")
          ? "running"
          : "ok";
  return <span className={`pill pill-${tone}`}>{label}</span>;
}

export function DirectionChip({ direction, failed = false }: { direction?: string; failed?: boolean }) {
  if (failed || !direction) return <span className="chip chip-failed">× Failed</span>;
  const tone = direction === "long" ? "long" : direction === "short" ? "short" : "stand";
  return (
    <span className={`chip chip-${tone}`}>
      <span aria-hidden="true">{directionArrow(direction)}</span>
      {directionLabel(direction)}
    </span>
  );
}

export function MiniMark({ direction, failed = false }: { direction?: string; failed?: boolean }) {
  if (failed || !direction) return <span className="mini mini-failed">×</span>;
  const tone = direction === "long" ? "long" : direction === "short" ? "short" : "stand";
  return <span className={`mini mini-${tone}`}>{directionArrow(direction)}</span>;
}

export function GradeBadge({ grade }: { grade: string }) {
  const tone = grade === "A+" ? "a" : grade === "B" ? "b" : "nt";
  return <span className={`grade grade-${tone}`}>{grade === "NO TRADE" ? "NT" : grade}</span>;
}

export function StackedBar({ pass, fail, notVisible }: { pass: number; fail: number; notVisible: number }) {
  const total = pass + fail + notVisible || 1;
  return (
    <div className="bar" aria-hidden="true">
      <span className="pass" style={{ width: `${(pass / total) * 100}%` }} />
      <span className="fail" style={{ width: `${(fail / total) * 100}%` }} />
      <span className="nv" style={{ width: `${(notVisible / total) * 100}%` }} />
    </div>
  );
}

export function CheckCounts({ pass, fail, notVisible }: { pass: number; fail: number; notVisible: number }) {
  return (
    <p className="count-line">
      <span className="c-pass">{pass} pass</span>
      <span className="c-fail">{fail} fail</span>
      <span className="c-nv">{notVisible} not visible</span>
    </p>
  );
}

export function AssetMeta({
  grade,
  confidence,
  poor = false,
  failed = false,
  compact = false,
}: {
  grade?: string;
  confidence?: string;
  poor?: boolean;
  failed?: boolean;
  compact?: boolean;
}) {
  if (failed) return <span className="meta">capture</span>;
  if (!grade && !confidence && !poor) return null;
  const gradeText = grade === "NO TRADE" ? "NO TRADE" : grade;
  const conf = confidence ? confidenceLabel(confidence, compact) : null;
  return (
    <span className="meta">
      {gradeText}
      {gradeText && (poor || conf) ? " · " : ""}
      {poor ? <span className="poor">poor capture</span> : conf}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  kicker = false,
  back,
  trailing,
  detail = false,
}: {
  title: string;
  subtitle?: string;
  kicker?: boolean;
  back?: { to: string; label: string };
  trailing?: ReactNode;
  detail?: boolean;
}) {
  useDocumentTitle(title);
  return (
    <header className={`page-head${detail ? " detail" : ""}`}>
      <div className="title-row">
        {back ? (
          <Link className="back" to={back.to} aria-label={back.label}>
            <Icon name="chevronLeft" />
          </Link>
        ) : null}
        <div>
          {kicker ? <p className="kicker mobile-only">FX CHART ANALYST</p> : null}
          <h1 className={`page-title${detail ? " detail" : ""}`}>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {trailing}
    </header>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · FX Chart Analyst` : "FX Chart Analyst";
  }, [title]);
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Could not load this page.";
  return (
    <div className="card error-card" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button className="btn" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="skeleton" />
      <div className="skeleton tall" />
      <p className="loading-label">{label}</p>
    </div>
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<"dark" | "light">(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  const setTheme = (next: "dark" | "light") => {
    document.documentElement.dataset.theme = next;
    localStorage.setItem("fx-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f4f6f9" : "#0b0e13");
    setThemeState(next);
  };
  return { theme, setTheme };
}

export function UserButton() {
  const auth = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  if (!auth.user) return null;
  return (
    <div className="user-wrap">
      <button className="user-btn" type="button" aria-label="Account" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="user" />
      </button>
      {open ? (
        <div className="user-menu" role="menu">
          <p className="user-email">{auth.user.email ?? auth.user.name ?? "Signed in"}</p>
          <button type="button" role="menuitem" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void auth.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function gradeClass(grade?: string): string {
  if (grade === "A+") return "a";
  if (grade === "B") return "b";
  return "nt";
}

export function shortGrade(grade?: string): string {
  return grade ? gradeShort(grade) : "";
}
