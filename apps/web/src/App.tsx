import { Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { Architecture } from "./pages/Architecture";
import { StatusPage } from "./pages/Status";

export function App() {
  return (
    <div className="shell">
      <header className="site-header">
        <Link className="brand" to="/">
          Fla<span>re</span>
        </Link>
        <nav className="nav-links">
          <Link to="/architecture">Architecture</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/s/:code" element={<StatusPage />} />
        <Route path="/architecture" element={<Architecture />} />
      </Routes>
    </div>
  );
}
