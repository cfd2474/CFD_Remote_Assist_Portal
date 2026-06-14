import { useAuth } from "react-oidc-context";

export function Login() {
  const auth = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <img
          src="/eud-remote-assist-banner.jpg"
          alt="EUD Remote Assist"
          className="login-logo"
        />
        <p>Sign in with your organization account to manage enrolled Android devices.</p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void auth.signinRedirect()}
        >
          Sign in with Authentik
        </button>
      </div>
    </div>
  );
}
