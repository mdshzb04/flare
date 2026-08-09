import { NavLink, Outlet } from "react-router-dom";

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
        <a
          className="brand"
          href="/"
          title="Flare home"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = "/";
          }}
        >
          Fla<span>re</span>
        </a>
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
