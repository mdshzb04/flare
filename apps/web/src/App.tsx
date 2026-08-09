import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { Architecture } from "./pages/Architecture";
import { Automation } from "./pages/Automation";
import { Dashboard } from "./pages/Dashboard";
import { IncidentDetail } from "./pages/IncidentDetail";
import { Incidents } from "./pages/Incidents";
import { Integrations } from "./pages/Integrations";
import { RoomPage } from "./pages/Room";
import { ServiceDetail } from "./pages/ServiceDetail";
import { Services } from "./pages/Services";
import { Settings } from "./pages/Settings";
import { StatusPage } from "./pages/Status";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/incidents/:code" element={<IncidentDetail />} />
        <Route path="/services" element={<Services />} />
        <Route path="/services/:id" element={<ServiceDetail />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/automation" element={<Automation />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/architecture" element={<Architecture />} />
      </Route>
      <Route path="/r/:code" element={<RoomPage />} />
      <Route path="/s/:code" element={<StatusPage />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
