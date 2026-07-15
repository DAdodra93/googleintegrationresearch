import { useCallback, useEffect, useState } from 'react';
import type { Merchant } from './api';
import { gbpApi, type GbpProfile, type GbpReview } from './gbpApi';

export default function GbpPanel({ merchant }: { merchant: Merchant }) {
  const [profiles, setProfiles] = useState<GbpProfile[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setErr('');
    try {
      const list = await gbpApi.profiles(merchant.id);
      setProfiles(list);
      if (!list.find((p) => p.id === selected)) setSelected(list[0]?.id ?? '');
    } catch (e) {
      setErr(String(e));
    }
  }, [merchant.id, selected]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const profile = profiles.find((p) => p.id === selected) ?? null;

  return (
    <>
      {err && <div className="err">{err}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      <ProfileSetup merchant={merchant} onChange={refresh} setErr={setErr} setNotice={setNotice} />
      {profiles.length > 0 && (
        <div className="card row">
          <label className="muted">Profile</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.flow}) — {p.status}
              </option>
            ))}
          </select>
        </div>
      )}
      {profile && ['draft', 'create_proposed', 'created', 'verification_pending'].includes(profile.status) && (
        <VerificationFlow profile={profile} onChange={refresh} setErr={setErr} setNotice={setNotice} />
      )}
      {profile && ['connected', 'verified'].includes(profile.status) && (
        <ManagementSurface key={profile.id} profile={profile} setErr={setErr} setNotice={setNotice} />
      )}
    </>
  );
}

function ProfileSetup({ merchant, onChange, setErr, setNotice }: any) {
  const [mode, setMode] = useState<'' | 'existing' | 'new'>('');
  const [discovery, setDiscovery] = useState<any[]>([]);
  const [draft, setDraft] = useState({
    businessName: '', category: 'Cafe', addressLines: '', locality: '', administrativeArea: '',
    postalCode: '', regionCode: merchant.countryCode ?? 'IN', phone: '', websiteUri: '', businessDetails: '',
  });

  if (!mode) {
    return (
      <div className="row" style={{ margin: '12px 0' }}>
        <button
          className="primary"
          onClick={async () => {
            try {
              setDiscovery(await gbpApi.discover(merchant.id));
              setMode('existing');
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Flow A — connect existing profile
        </button>
        <button onClick={() => setMode('new')}>Flow B — create new profile</button>
        <span className="muted">Flow A needs the GBP OAuth connection (Connections tab) first.</span>
      </div>
    );
  }

  if (mode === 'existing') {
    return (
      <div className="card">
        <h2>Select a location to manage</h2>
        {discovery.map(({ account, locations }) =>
          locations.map((l: any) => (
            <div key={l.name} className="row" style={{ marginBottom: 6 }}>
              <span className="grow">
                {l.title} <span className="muted">({l.name})</span>
              </span>
              <span className={`pill ${l.verified ? 'active' : 'pending'}`}>{l.verified ? 'verified' : 'unverified'}</span>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await gbpApi.connectExisting({ merchantId: merchant.id, accountName: account.name, locationName: l.name, title: l.title });
                    setNotice('Profile connected.');
                    setMode('');
                    onChange();
                  } catch (e) {
                    setErr(String(e));
                  }
                }}
              >
                Manage
              </button>
            </div>
          )),
        )}
        <button onClick={() => setMode('')}>Cancel</button>
      </div>
    );
  }

  const set = (k: string) => (e: any) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="card">
      <h2>New profile — AI pre-fills, Google verifies</h2>
      <div className="row">
        <input className="grow" placeholder="Business name" value={draft.businessName} onChange={set('businessName')} />
        <input placeholder="Category" value={draft.category} onChange={set('category')} />
        <input placeholder="Phone (+91 …)" value={draft.phone} onChange={set('phone')} />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="grow" placeholder="Address line" value={draft.addressLines} onChange={set('addressLines')} />
        <input placeholder="City" value={draft.locality} onChange={set('locality')} />
        <input placeholder="State" style={{ width: 70 }} value={draft.administrativeArea} onChange={set('administrativeArea')} />
        <input placeholder="PIN code" style={{ width: 90 }} value={draft.postalCode} onChange={set('postalCode')} />
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="grow" placeholder="Website (optional)" value={draft.websiteUri} onChange={set('websiteUri')} />
      </div>
      <textarea
        style={{ width: '100%', minHeight: 50, marginTop: 6 }}
        placeholder="What does the business do? (AI expands this into the profile description)"
        value={draft.businessDetails}
        onChange={set('businessDetails')}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          onClick={async () => {
            try {
              await gbpApi.createDraft({
                merchantId: merchant.id,
                ...draft,
                addressLines: [draft.addressLines],
                websiteUri: draft.websiteUri || undefined,
                administrativeArea: draft.administrativeArea || undefined,
              });
              setNotice('Draft created with AI-prefilled description. Propose creation below.');
              setMode('');
              onChange();
            } catch (e) {
              setErr(String(e));
            }
          }}
        >
          Create AI-prefilled draft
        </button>
        <button onClick={() => setMode('')}>Cancel</button>
      </div>
    </div>
  );
}

function VerificationFlow({ profile, onChange, setErr, setNotice }: { profile: GbpProfile; onChange: () => void; setErr: any; setNotice: any }) {
  const [options, setOptions] = useState<Array<{ method: string; detail?: string }>>([]);
  const [pin, setPin] = useState('');

  return (
    <div className="card">
      <h2>
        Net-new profile: <span className="pill pending">{profile.status}</span>
      </h2>
      {profile.status === 'draft' && (
        <>
          {profile.prefill?.description && <div className="muted">AI description: {profile.prefill.description.slice(0, 180)}…</div>}
          <button
            className="primary"
            onClick={async () => {
              try {
                await gbpApi.proposeCreate(profile.id);
                setNotice('Creation proposed — approve it in the Approvals tab, then come back here.');
                onChange();
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Propose profile creation
          </button>
        </>
      )}
      {profile.status === 'create_proposed' && <div className="muted">Waiting for approval (Approvals tab), then refresh.</div>}
      {profile.status === 'created' && (
        <>
          <div className="muted">Location created (unverified). Pick a verification method — Google decides which are offered:</div>
          {options.length === 0 ? (
            <button onClick={async () => setOptions(await gbpApi.verificationOptions(profile.id).catch((e) => (setErr(String(e)), [])))}>
              Fetch verification options
            </button>
          ) : (
            options.map((o) => (
              <div key={o.method} className="row" style={{ marginTop: 6 }}>
                <span className="grow">
                  <strong>{o.method}</strong> <span className="muted">{o.detail}</span>
                </span>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await gbpApi.startVerification(profile.id, o.method);
                      setNotice(o.method === 'VIDEO' ? 'Video verification must be finished in the Google UI/app — status is polled here.' : 'Verification started — enter the PIN when it arrives.');
                      onChange();
                    } catch (e) {
                      setErr(String(e));
                    }
                  }}
                >
                  Use
                </button>
              </div>
            ))
          )}
        </>
      )}
      {profile.status === 'verification_pending' && (
        <>
          <div className="banner">{profile.verification?.note}</div>
          {profile.verification?.method !== 'VIDEO' && (
            <div className="row">
              <input placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await gbpApi.completeVerification(profile.id, pin);
                    setNotice('Verified! Full management surface unlocked.');
                    onChange();
                  } catch (e) {
                    setErr(String(e));
                  }
                }}
              >
                Complete verification
              </button>
            </div>
          )}
          <button onClick={onChange}>Re-check status</button>
        </>
      )}
    </div>
  );
}

function ManagementSurface({ profile, setErr, setNotice }: { profile: GbpProfile; setErr: any; setNotice: any }) {
  const [info, setInfo] = useState<any>(null);
  const [desc, setDesc] = useState('');
  const [reviews, setReviews] = useState<GbpReview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [posts, setPosts] = useState<any[]>([]);
  const [postTopic, setPostTopic] = useState('');
  const [postText, setPostText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [perf, setPerf] = useState<any>(null);
  const [kws, setKws] = useState<Array<{ keyword: string; impressions: number }>>([]);

  const load = useCallback(async () => {
    try {
      const i = await gbpApi.info(profile.id);
      setInfo(i);
      setDesc(i.description ?? '');
      setReviews(await gbpApi.reviews(profile.id));
      setPosts(await gbpApi.posts(profile.id));
      setPerf(await gbpApi.performance(profile.id));
      setKws(await gbpApi.keywords(profile.id));
    } catch (e) {
      setErr(String(e));
    }
  }, [profile.id, setErr]);
  useEffect(() => {
    load();
  }, [load]);

  if (!info) return <div className="muted">loading profile…</div>;
  const propose = (fn: () => Promise<unknown>, msg: string) => async () => {
    try {
      await fn();
      setNotice(msg + ' — approve in the Approvals tab.');
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <>
      {perf && (
        <div className="card row muted">
          <span>28d: {perf.totals.impressionsSearch + perf.totals.impressionsMaps} impressions</span>
          <span>{perf.totals.callClicks} calls</span>
          <span>{perf.totals.websiteClicks} site clicks</span>
          <span>{perf.totals.directionRequests} directions</span>
          <span>trend: impressions {fmtPct(perf.beforeAfterTrendPct.impressions)}, calls {fmtPct(perf.beforeAfterTrendPct.calls)}</span>
        </div>
      )}
      <div className="card">
        <h2>Business info</h2>
        <div className="muted">
          {info.title} · {info.primaryCategory} · {info.phone} · {info.websiteUri}
        </div>
        <textarea style={{ width: '100%', minHeight: 70, marginTop: 6 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="row">
          <button
            onClick={async () => {
              try {
                const r = await gbpApi.aiRewrite({ profileId: profile.id, field: 'description', current: desc });
                setDesc(r.suggestion);
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            AI: rewrite for SEO
          </button>
          <button className="primary" onClick={propose(() => gbpApi.proposeInfoUpdate(profile.id, { description: desc }), 'Description update proposed')}>
            Propose update
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Reviews ({reviews.length})</h2>
        {reviews.map((r) => (
          <div key={r.reviewName} style={{ marginBottom: 10 }}>
            <div className="row">
              <strong>{'★'.repeat(r.starRating)}{'☆'.repeat(5 - r.starRating)}</strong>
              <span className="grow">{r.reviewer}</span>
              <span className="muted">{new Date(r.createTime).toLocaleDateString()}</span>
            </div>
            <div>{r.comment}</div>
            {r.reply ? (
              <div className="muted">↳ replied: {r.reply.comment}</div>
            ) : (
              <div className="row" style={{ marginTop: 4 }}>
                <input
                  className="grow"
                  placeholder="Reply text"
                  value={drafts[r.reviewName] ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [r.reviewName]: e.target.value })}
                />
                <button
                  onClick={async () => {
                    try {
                      const d = await gbpApi.aiReviewReply({ profileId: profile.id, reviewName: r.reviewName });
                      setDrafts({ ...drafts, [r.reviewName]: d.suggestion });
                    } catch (e) {
                      setErr(String(e));
                    }
                  }}
                >
                  AI draft
                </button>
                <button
                  className="primary"
                  disabled={!(drafts[r.reviewName] ?? '').trim()}
                  onClick={propose(() => gbpApi.proposeReviewReply(profile.id, r.reviewName, drafts[r.reviewName]), 'Reply proposed')}
                >
                  Propose reply
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Posts ({posts.length})</h2>
        {posts.map((p) => (
          <div key={p.name} className="row muted">
            <span className="pill active">{p.state}</span>
            <span className="grow">{p.summary.slice(0, 120)}</span>
            <span>{new Date(p.createTime).toLocaleDateString()}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 6 }}>
          <input className="grow" placeholder="Post topic (e.g. new menu, festive hours)" value={postTopic} onChange={(e) => setPostTopic(e.target.value)} />
          <button
            disabled={!postTopic.trim()}
            onClick={async () => {
              try {
                const p = await gbpApi.aiPost({ profileId: profile.id, topic: postTopic });
                setPostText(p.summary);
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            AI: draft post
          </button>
        </div>
        {postText && (
          <>
            <textarea style={{ width: '100%', minHeight: 60, marginTop: 6 }} value={postText} onChange={(e) => setPostText(e.target.value)} />
            <button className="primary" onClick={propose(() => gbpApi.proposePost(profile.id, { summary: postText, topicType: 'STANDARD' }), 'Post proposed')}>
              Propose publish
            </button>
          </>
        )}
      </div>

      <div className="card">
        <h2>Photos</h2>
        <div className="row">
          <input className="grow" placeholder="Image URL" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
          <button
            className="primary"
            disabled={!mediaUrl.trim()}
            onClick={propose(() => gbpApi.proposeMedia(profile.id, { sourceUrl: mediaUrl, category: 'ADDITIONAL' }), 'Photo upload proposed')}
          >
            Propose upload
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Search keywords (local SEO)</h2>
        {kws.map((k) => (
          <div key={k.keyword} className="row muted">
            <span className="grow">{k.keyword}</span>
            <span>{k.impressions} impressions</span>
          </div>
        ))}
      </div>
    </>
  );
}

const fmtPct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
