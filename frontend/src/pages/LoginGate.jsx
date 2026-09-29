export default function LoginGate({ scopes = [] }) {
  return (
    <div className="card gate">
      <div className="mark">L</div>
      <h2>Connect your Instagram business account</h2>
      <p>
        LimbuAI manages comments, DMs, insights and posts for your account. Sign in with Instagram and approve the permissions
        below.
      </p>
      <a className="btn ig" href="/auth/login">
        Continue with Instagram
      </a>
      <div className="scopes">
        {scopes.map((s) => (
          <span key={s} className="badge mono">
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
