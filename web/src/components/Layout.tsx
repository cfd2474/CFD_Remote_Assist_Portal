import { useAuth } from "react-oidc-context";
import { Link, Outlet } from "react-router-dom";
import { AppFooter } from "./AppFooter";

export function Layout() {
  const auth = useAuth();
  const profile = auth.user?.profile;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <Link to="/" className="header-brand-link">
            <img
              src="/eud-remote-assist-banner.jpg"
              alt="EUD Remote Assist"
              className="header-brand-logo"
            />
          </Link>
        </div>
        <div className="header-user">
          <span>{profile?.name ?? profile?.email ?? "Admin"}</span>
          <button type="button" onClick={() => void auth.signoutRedirect()}>
            Sign out
          </button>
        </div>
      </header>
      <div className="app-subheader">
        <nav className="app-subheader-nav app-subheader-nav-start" aria-label="Primary">
          <Link to="/" className="app-subheader-link">
            Managed Devices
          </Link>
        </nav>
        <nav className="app-subheader-nav app-subheader-nav-end" aria-label="Resources">
          <Link to="/documentation" className="app-subheader-link">
            Documentation
          </Link>
          <Link to="/download" className="app-subheader-link">
            Download EUD Remote Assist .apk
          </Link>
        </nav>
      </div>
      <main className="app-main">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
