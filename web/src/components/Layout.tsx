import { useAuth } from "react-oidc-context";
import { Link, Outlet } from "react-router-dom";

export function Layout() {
  const auth = useAuth();
  const profile = auth.user?.profile;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <Link to="/">CFD Remote Assist</Link>
        </div>
        <div className="header-user">
          <span>{profile?.name ?? profile?.email ?? "Admin"}</span>
          <button type="button" onClick={() => void auth.signoutRedirect()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
