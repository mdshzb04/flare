import { Link, NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/dashboard", label: "Dashboard", end: true },
  { to: "/incidents", label: "Incidents" },
  { to: "/integrations", label: "Integrations" },
  { to: "/automation", label: "Automation" },
];

export function AppShell() {
  return (
    <div className="shell product-shell">
      <header className="site-header product-header">
        <Link className="brand" to="/" title="Flare home">
          Fla<span>re</span>
        </Link>
        <nav className="nav-links product-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
