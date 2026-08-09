import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { Architecture } from "./pages/Architecture";
import { Automation } from "./pages/Automation";
import { Dashboard } from "./pages/Dashboard";
import { IncidentDetail } from "./pages/IncidentDetail";
import { Incidents } from "./pages/Incidents";
import { Integrations } from "./pages/Integrations";
import { Landing } from "./pages/Landing";
import { RoomPage } from "./pages/Room";
import { StatusPage } from "./pages/Status";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/incidents/:code" element={<IncidentDetail />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/architecture" element={<Architecture />} />
      </Route>
      <Route path="/r/:code" element={<RoomPage />} />
      <Route path="/s/:code" element={<StatusPage />} />
      <Route path="/services" element={<Navigate to="/dashboard" replace />} />
      <Route path="/services/:id" element={<Navigate to="/dashboard" replace />} />
      <Route path="/settings" element={<Navigate to="/dashboard" replace />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
      <Route path="/app" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
