import { useAuth } from '../../services/AuthContext';

export default function LoginPage() {
  const { signInGoogle, loading, error } = useAuth();

  return (
    <div className="login-shell">
      <div className="login-card">

        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-mark">PG</div>
          <div>
            <div className="login-wordmark">ProxyGuard Studio</div>
            <div className="login-tagline">FAIRNESS AUDITING PLATFORM</div>
          </div>
        </div>

        {/* Hero text */}
        <div className="login-headline">
          The smoke detector<br />
          <em>ML developers never had.</em>
        </div>

        <p className="login-sub">
          Upload a dataset. Get a cryptographically-signed bias audit in under 10 seconds.
          Pure mathematics, no AI auditing AI.
        </p>

        {/* Trust badges */}
        <div className="login-badges">
          <span className="login-badge">Deterministic</span>
          <span className="login-badge">SHA-256 Signed</span>
          <span className="login-badge">EEOC 4/5ths Rule</span>
          <span className="login-badge">Free Tier</span>
        </div>

        {/* Sign in */}
        {error && <div className="login-error">{error}</div>}

        <button
          className="google-btn"
          onClick={signInGoogle}
          disabled={loading}
        >
          <GoogleIcon />
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>

        <p className="login-legal">
          By signing in you agree to use this tool responsibly.
          ProxyGuard Studio does not store your dataset contents.
        </p>
      </div>

      {/* Background decoration */}
      <div className="login-bg-text" aria-hidden="true">
        FAIRNESS · BIAS · EQUITY · COMPLIANCE · TRANSPARENCY ·
        DISPARATE IMPACT · PROXY VARIABLES · MUTUAL INFORMATION ·
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}
