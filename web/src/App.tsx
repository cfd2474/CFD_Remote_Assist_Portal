import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "react-oidc-context";
import { Layout } from "./components/Layout";
import { DeviceList } from "./pages/DeviceList";
import { DeviceDetail } from "./pages/DeviceDetail";
import { DeviceLocationHistory } from "./pages/DeviceLocationHistory";
import { AppDownload } from "./pages/AppDownload";
import { Callback } from "./pages/Callback";
import { Login } from "./pages/Login";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.isLoading) {
    return <p className="loading">Loading…</p>;
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/callback" element={<Callback />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DeviceList />} />
          <Route path="download" element={<AppDownload />} />
          <Route path="devices/:uid" element={<DeviceDetail />} />
          <Route path="devices/:uid/location-history" element={<DeviceLocationHistory />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
