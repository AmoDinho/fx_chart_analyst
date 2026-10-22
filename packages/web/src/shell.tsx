import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Icon, UserButton } from "./ui";

const LINKS = [
  { to: "/", label: "Days", icon: "calendar" as const, match: (path: string) => path === "/" || path.startsWith("/d/") || path.startsWith("/r/") },
  { to: "/a/nasdaq100", label: "History", icon: "trend" as const, match: (path: string) => path.startsWith("/a/") },
  { to: "/runs", label: "Runs", icon: "list" as const, match: (path: string) => path.startsWith("/runs") },
  { to: "/admin", label: "Admin", icon: "sliders" as const, match: (path: string) => path.startsWith("/admin") },
];

export function Shell() {
  const location = useLocation();
  const auth = useAuth();
  const admin = location.pathname.startsWith("/admin");
  const detail = /^\/(d\/|r\/|runs\/)/.test(location.pathname);
  const group = auth.user?.groups.includes("admins") ? "admins" : auth.user?.groups[0] ?? "viewer";
  return (
    <div className={`app${admin ? " admin-route" : ""}${detail ? " detail-route" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <p className="brand-kicker">FX CHART ANALYST</p>
          <p className="brand-sub">Nasdaq 100 · Gold</p>
        </div>
        <nav className="nav" aria-label="Primary">
          {LINKS.map((link) => (
            <NavLink key={link.label} to={link.to} className={() => `nav-item${link.match(location.pathname) ? " active" : ""}`}>
              <Icon name={link.icon} />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <footer className="sidebar-foot">
          <p>Weekday runs at 09:00 SAST</p>
          <p>Signed in · {group}</p>
        </footer>
      </aside>
      <div className="main">
        {admin ? null : <UserButton />}
        <div className="content">
          <Outlet />
        </div>
      </div>
      <nav className="tabbar" aria-label="Primary">
        {LINKS.map((link) => (
          <NavLink key={link.label} to={link.to} className={() => `tab-item${link.match(location.pathname) ? " active" : ""}`}>
            <Icon name={link.icon} />
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
