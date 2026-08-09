import { Link, NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/incidents", label: "Incidents" },
  { to: "/services", label: "Services" },
  { to: "/integrations", label: "Integrations" },
  { to: "/automation", label: "Automation" },
  { to: "/settings", label: "Settings" },
];

export function AppShell() {
  return (
    <div className="shell product-shell">
      <header className="site-header product-header">
        <div className="brand-row">
          <Link className="brand" to="/">
            Fla<span>re</span>
          </Link>
          <span className="demo-pill" title="Worker load sim + cascade demo">
            DEMO MODE
          </span>
        </div>
        <nav className="nav-links product-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
