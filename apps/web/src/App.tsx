import { Link, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { Architecture } from "./pages/Architecture";

export function App() {
  return (
    <div className="shell">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <Link className="brand" to="/">
          Fla<span>re</span>
        </Link>
        <nav className="row muted">
          <Link to="/architecture">Architecture</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="/architecture" element={<Architecture />} />
      </Routes>
    </div>
  );
}
