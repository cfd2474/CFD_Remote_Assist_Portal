import { useAuth } from "react-oidc-context";

export function Login() {
  const auth = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>CFD Remote Assist</h1>
        <p>Sign in with your organization account to manage managed Android devices.</p>
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
