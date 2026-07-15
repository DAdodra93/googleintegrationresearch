import { useCallback, useEffect, useState } from 'react';
import { api, type Approval, type Connection, type Merchant, type SessionUser, type SystemStatus } from './api';
import AdsPanel from './AdsPanel';
import GbpPanel from './GbpPanel';

type Tab = 'connections' | 'gbp' | 'ads' | 'approvals' | 'system';

export default function App() {
  const [user, setUser] = useState<SessionUser | null | 'loading'>('loading');
  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);
  if (user === 'loading') return <div className="shell muted">loading…</div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return <Workspace user={user} onLogout={() => api.logout().then(() => setUser(null))} />;
}

function AuthScreen({ onAuthed }: { onAuthed: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      const r = mode === 'login' ? await api.login(email, password) : await api.signup(email, password, businessName || undefined);
      onAuthed(r.user);
    } catch (e) {
      setErr(String(e));
    }
  };
  return (
    <div className="shell" style={{ maxWidth: 420 }}>
      <h1>Google Growth Engine</h1>
      <div className="card">
        <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Password (8+ chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          {mode === 'signup' && (
            <input placeholder="Your business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          )}
          {err && <div className="err">{err}</div>}
          <button className="primary" onClick={submit}>
            {mode === 'login' ? 'Sign in' : 'Sign up'}
          </button>
          <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Workspace({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>(() => localStorage.getItem('gge.merchantId') ?? '');
  const [tab, setTab] = useState<Tab>('connections');
  const [error, setError] = useState('');

  const refreshMerchants = useCallback(async () => {
    const list = await api.merchants();
    setMerchants(list);
    if (!list.find((m) => m.id === merchantId)) setMerchantId(list[0]?.id ?? '');
  }, [merchantId]);

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setError(String(e)));
    refreshMerchants().catch((e) => setError(String(e)));
  }, [refreshMerchants]);

  useEffect(() => {
    if (merchantId) localStorage.setItem('gge.merchantId', merchantId);
  }, [merchantId]);

  const merchant = merchants.find((m) => m.id === merchantId) ?? null;

  return (
    <div className="shell">
      <div className="row">
        <h1 className="grow">Google Growth Engine</h1>
        {status?.google.stub && <span className="pill stub">GOOGLE STUB MODE</span>}
        {status?.ai.stub && <span className="pill stub">AI STUB</span>}
        <span className="pill stub">{user.email} · {user.role}</span>
        <button onClick={onLogout}>Sign out</button>
      </div>
      {status?.store === 'memory' && (
        <div className="banner">In-memory store — data resets on server restart. Set DATABASE_URL for persistence.</div>
      )}
      {error && <div className="err">{error}</div>}

      <MerchantPicker merchants={merchants} merchantId={merchantId} onSelect={setMerchantId} onCreated={refreshMerchants} />

      <nav>
        {(['connections', 'gbp', 'ads', 'approvals', 'system'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'connections' && merchant && <Connections merchant={merchant} />}
      {tab === 'gbp' && merchant && <GbpPanel merchant={merchant} />}
      {tab === 'ads' && merchant && <AdsPanel merchant={merchant} isOperator={user.role === 'operator'} />}
      {tab === 'approvals' && merchant && <Approvals merchant={merchant} />}
      {tab === 'system' && <SystemPanel status={status} />}
      {!merchant && tab !== 'system' && <div className="muted">Create a merchant to begin.</div>}
    </div>
  );
}

function MerchantPicker(props: {
  merchants: Merchant[];
  merchantId: string;
  onSelect: (id: string) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="card row">
      <label className="muted">Merchant</label>
      <select value={props.merchantId} onChange={(e) => props.onSelect(e.target.value)}>
        {props.merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.countryCode}/{m.currencyCode})
          </option>
        ))}
      </select>
      <span className="grow" />
      <input placeholder="New merchant name" value={name} onChange={(e) => setName(e.target.value)} />
      <button
        className="primary"
        disabled={!name || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.createMerchant(name);
            setName('');
            await props.onCreated();
          } finally {
            setBusy(false);
          }
        }}
      >
        Add
      </button>
    </div>
  );
}

function Connections({ merchant }: { merchant: Merchant }) {
  const [conns, setConns] = useState<Connection[]>([]);
  const refresh = useCallback(() => api.connections(merchant.id).then(setConns), [merchant.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const modules: Array<{ key: 'gbp' | 'ads'; title: string; blurb: string }> = [
    { key: 'gbp', title: 'Google Business Profile', blurb: 'Profile info, posts, media, reviews, performance (Phase 2)' },
    { key: 'ads', title: 'Google Ads', blurb: 'Campaigns, budgets, insights, TCPL loop (Phase 3)' },
  ];

  return (
    <>
      {modules.map(({ key, title, blurb }) => {
        const conn = conns.find((c) => c.module === key);
        return (
          <div key={key} className="card row">
            <div className="grow">
              <div className="row">
                <strong>{title}</strong>
                {conn ? <span className={`pill ${conn.status}`}>{conn.status}</span> : <span className="muted">not connected</span>}
              </div>
              <div className="muted">{conn ? `${conn.googleEmail ?? 'unknown account'} · since ${new Date(conn.connectedAt).toLocaleString()}` : blurb}</div>
            </div>
            {conn ? (
              <button className="danger" onClick={() => api.disconnect(conn.id).then(refresh)}>
                Disconnect
              </button>
            ) : (
              <button className="primary" onClick={() => (window.location.href = `/auth/google/${key}/start?merchantId=${merchant.id}`)}>
                Connect
              </button>
            )}
          </div>
        );
      })}
      <div className="muted">Modules connect independently — either can be used without the other.</div>
    </>
  );
}

function Approvals({ merchant }: { merchant: Merchant }) {
  const [items, setItems] = useState<Approval[]>([]);
  const refresh = useCallback(() => api.approvals().then(setItems), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const pending = items.filter((a) => a.status === 'pending');
  const history = items.filter((a) => a.status !== 'pending').slice(0, 20);

  return (
    <>
      <div className="row">
        <h2 className="grow">Pending approvals ({pending.length})</h2>
        <button onClick={() => api.demoApproval(merchant.id).then(refresh)}>Propose demo action</button>
      </div>
      {pending.length === 0 && <div className="muted">Nothing waiting. External / money-moving actions will queue here.</div>}
      {pending.map((a) => (
        <div key={a.id} className="card">
          <div className="row">
            <span className="pill stub">{a.module.toUpperCase()}</span>
            <strong className="grow">{a.summary}</strong>
            <button className="primary" onClick={() => api.approve(a.id).then(refresh)}>
              Approve
            </button>
            <button className="danger" onClick={() => api.reject(a.id).then(refresh)}>
              Reject
            </button>
          </div>
          <div className="muted">
            {a.actionType} · proposed by {a.proposedBy} · {new Date(a.createdAt).toLocaleString()}
          </div>
          <pre>{JSON.stringify(a.payload, null, 2)}</pre>
        </div>
      ))}

      <h2>History</h2>
      {history.map((a) => (
        <div key={a.id} className="card row">
          <span className={`pill ${a.status}`}>{a.status}</span>
          <span className="grow">{a.summary}</span>
          {a.error && <span className="err">{a.error}</span>}
          <span className="muted">{new Date(a.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </>
  );
}

function SystemPanel({ status }: { status: SystemStatus | null }) {
  const [prompt, setPrompt] = useState('Rewrite this business description to be SEO-friendly: chai shop in Indiranagar.');
  const [aiOut, setAiOut] = useState('');
  if (!status) return <div className="muted">loading…</div>;
  return (
    <>
      <div className="card">
        <h2>Configuration</h2>
        <pre>{JSON.stringify(status, null, 2)}</pre>
        <div className="muted">
          Flip stub → real by setting GOOGLE_CLIENT_ID/SECRET, OPENAI_API_KEY, DATABASE_URL and ADS_* in the environment — no code changes.
        </div>
      </div>
      <div className="card">
        <h2>AI seam check</h2>
        <div className="row">
          <input className="grow" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <button className="primary" onClick={() => api.aiComplete(prompt).then((r) => setAiOut(`[${r.provider}] ${r.output}`))}>
            Run
          </button>
        </div>
        {aiOut && <pre>{aiOut}</pre>}
      </div>
      <AuditPanel />
    </>
  );
}

function AuditPanel() {
  const [events, setEvents] = useState<Array<{ event: string; module?: string; createdAt: string }>>([]);
  useEffect(() => {
    api.audit().then(setEvents).catch(() => setEvents([])); // operator-only endpoint
  }, []);
  return (
    <div className="card">
      <h2>Audit trail (latest)</h2>
      {events.map((e, i) => (
        <div key={i} className="row muted">
          <span className="grow">
            {e.module ? `[${e.module}] ` : ''}
            {e.event}
          </span>
          <span>{new Date(e.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
