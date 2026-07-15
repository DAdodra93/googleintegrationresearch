import { useCallback, useEffect, useState } from 'react';
import type { Merchant } from './api';
import { adsApi, type AdsAccount, type AdsCampaign, type Budget, type Insights } from './adsApi';

export default function AdsPanel({ merchant, isOperator }: { merchant: Merchant; isOperator: boolean }) {
  const [accounts, setAccounts] = useState<AdsAccount[]>([]);
  const [campaigns, setCampaigns] = useState<AdsCampaign[]>([]);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setErr('');
    try {
      setAccounts(await adsApi.accounts(merchant.id));
      setCampaigns(await adsApi.campaigns(merchant.id));
    } catch (e) {
      setErr(String(e));
    }
  }, [merchant.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeAccount = accounts.find((a) => a.linkStatus === 'active') ?? null;

  return (
    <>
      {err && <div className="err">{err}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      <AccountsSection accounts={accounts} merchant={merchant} onChange={refresh} setNotice={setNotice} isOperator={isOperator} />
      {activeAccount && (
        <CampaignCreate merchant={merchant} account={activeAccount} onCreated={refresh} setErr={setErr} setNotice={setNotice} />
      )}
      <h2>Campaigns</h2>
      {campaigns.length === 0 && <div className="muted">No campaigns yet.</div>}
      {campaigns.map((c) => (
        <CampaignCard key={c.id} campaign={c} onChange={refresh} setNotice={setNotice} setErr={setErr} />
      ))}
    </>
  );
}

function AccountsSection({
  accounts,
  merchant,
  onChange,
  setNotice,
  isOperator,
}: {
  accounts: AdsAccount[];
  merchant: Merchant;
  onChange: () => void;
  setNotice: (s: string) => void;
  isOperator: boolean;
}) {
  const [flow, setFlow] = useState<'existing_linked' | 'provisioned'>('provisioned');
  const [billingMode, setBillingMode] = useState('we_pay_provisioned');
  const [customerId, setCustomerId] = useState('');

  useEffect(() => {
    setBillingMode(flow === 'provisioned' ? 'we_pay_provisioned' : 'we_pay_transfer');
  }, [flow]);

  return (
    <>
      <h2>Ads accounts</h2>
      {accounts.map((a) => (
        <div key={a.id} className="card row">
          <div className="grow">
            <strong>{a.flow === 'provisioned' ? 'Provisioned (Flow B)' : `Linked existing (Flow A) — ${a.customerId}`}</strong>
            <div className="muted">
              customer: {a.customerId ?? '—'} · billing: {a.billingMode}
            </div>
          </div>
          <span className={`pill ${a.linkStatus === 'active' ? 'active' : 'pending'}`}>{a.linkStatus}</span>
          {a.funding && <span className={`pill ${a.funding === 'funded' ? 'funded' : 'pending'}`}>{a.funding}</span>}
          {a.funding === 'pending_manual_billing_setup' &&
            (isOperator ? (
              <button
                onClick={async () => {
                  await adsApi.markFunded(a.id);
                  setNotice('Marked funded — remember this reflects the manual Ads-UI billing step (ops runbook).');
                  onChange();
                }}
              >
                Mark billing done
              </button>
            ) : (
              <span className="muted">billing activation pending (platform team)</span>
            ))}
        </div>
      ))}
      <div className="card row">
        <select value={flow} onChange={(e) => setFlow(e.target.value as any)}>
          <option value="provisioned">Flow B — provision new account (we pay)</option>
          <option value="existing_linked">Flow A — link existing account</option>
        </select>
        {flow === 'existing_linked' && (
          <>
            <input placeholder="Customer ID (10 digits)" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
            <select value={billingMode} onChange={(e) => setBillingMode(e.target.value)}>
              <option value="we_pay_transfer">we pay (billing transfer)</option>
              <option value="manage_only">manage only (merchant pays)</option>
            </select>
          </>
        )}
        <button
          className="primary"
          onClick={async () => {
            await adsApi.setupAccount({
              merchantId: merchant.id,
              flow,
              billingMode,
              ...(flow === 'existing_linked' ? { customerId } : { name: `${merchant.name} Ads` }),
            });
            setNotice('Account action proposed — approve it in the Approvals tab.');
            onChange();
          }}
        >
          Set up
        </button>
      </div>
    </>
  );
}

const DEFAULT_KEYWORDS = 'your service near me\nbest local provider';

function CampaignCreate({
  merchant,
  account,
  onCreated,
  setErr,
  setNotice,
}: {
  merchant: Merchant;
  account: AdsAccount;
  onCreated: () => void;
  setErr: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('WhatsApp leads — search');
  const [channel, setChannel] = useState<'whatsapp' | 'instagram_dm'>('whatsapp');
  const [waNumber, setWaNumber] = useState('91');
  const [igUser, setIgUser] = useState('');
  const [prefill, setPrefill] = useState('Hi! I saw your ad and want to know more.');
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [headlines, setHeadlines] = useState('');
  const [descriptions, setDescriptions] = useState('');
  const [tcpl, setTcpl] = useState(50);
  const [ceiling, setCeiling] = useState(400);
  const [monthlyCap, setMonthlyCap] = useState(8000);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [busy, setBusy] = useState('');

  if (!open) {
    return (
      <div className="row" style={{ margin: '12px 0' }}>
        <button className="primary" onClick={() => setOpen(true)}>
          + New campaign (account {account.customerId})
        </button>
      </div>
    );
  }

  const kwList = keywords.split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <div className="card">
      <h2>New search campaign → {channel === 'whatsapp' ? 'WhatsApp' : 'Instagram DM'} leads</h2>
      <div className="row">
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" />
        <select value={channel} onChange={(e) => setChannel(e.target.value as any)}>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram_dm">Instagram DM</option>
        </select>
        {channel === 'whatsapp' ? (
          <input value={waNumber} onChange={(e) => setWaNumber(e.target.value)} placeholder="WA number (E.164, no +)" />
        ) : (
          <input value={igUser} onChange={(e) => setIgUser(e.target.value)} placeholder="IG username" />
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="grow" value={prefill} onChange={(e) => setPrefill(e.target.value)} placeholder="Prefilled chat message" />
      </div>

      <h2>Keywords (one per line)</h2>
      <textarea style={{ width: '100%', minHeight: 60 }} value={keywords} onChange={(e) => setKeywords(e.target.value)} />

      <div className="row">
        <h2 className="grow">Ad copy</h2>
        <button
          disabled={busy === 'copy'}
          onClick={async () => {
            setBusy('copy');
            try {
              const out = await adsApi.aiAdCopy({ merchantId: merchant.id, business: name, channel, keywords: kwList });
              setHeadlines(out.headlines.join('\n'));
              setDescriptions(out.descriptions.join('\n'));
            } catch (e) {
              setErr(String(e));
            } finally {
              setBusy('');
            }
          }}
        >
          {busy === 'copy' ? '…' : 'AI: generate copy'}
        </button>
      </div>
      <div className="row">
        <textarea className="grow" style={{ minHeight: 80 }} placeholder="Headlines (≤30 chars, one per line, min 3)" value={headlines} onChange={(e) => setHeadlines(e.target.value)} />
        <textarea className="grow" style={{ minHeight: 80 }} placeholder="Descriptions (≤90 chars, one per line, min 2)" value={descriptions} onChange={(e) => setDescriptions(e.target.value)} />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <h2 className="grow">Budget ({merchant.currencyCode})</h2>
        <label className="muted">target CPL</label>
        <input type="number" style={{ width: 90 }} value={tcpl} onChange={(e) => setTcpl(Number(e.target.value))} />
        <label className="muted">daily ceiling</label>
        <input type="number" style={{ width: 90 }} value={ceiling} onChange={(e) => setCeiling(Number(e.target.value))} />
        <label className="muted">monthly cap</label>
        <input type="number" style={{ width: 100 }} value={monthlyCap} onChange={(e) => setMonthlyCap(Number(e.target.value))} />
        <button
          disabled={busy === 'budget'}
          onClick={async () => {
            setBusy('budget');
            try {
              setBudget(await adsApi.aiBudget({ merchantId: merchant.id, targetCostPerLead: tcpl, hardDailyCeiling: ceiling, monthlyCap, keywords: kwList }));
            } catch (e) {
              setErr(String(e));
            } finally {
              setBusy('');
            }
          }}
        >
          {busy === 'budget' ? '…' : 'AI: propose budget'}
        </button>
      </div>
      {budget && (
        <div className="banner ok">
          Proposed daily budget: <strong>{budget.currency} {budget.dailyAmount}</strong> — {budget.rationale} <span className="muted">({budget.proposedBy})</span>
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="primary"
          disabled={!budget || busy === 'create'}
          onClick={async () => {
            setBusy('create');
            try {
              await adsApi.createCampaign({
                merchantId: merchant.id,
                adsAccountId: account.id,
                adType: 'search',
                name,
                budget,
                spec: {
                  geo: { countryCodes: [merchant.countryCode], locations: [] },
                  languageCodes: ['en'],
                  bidding: { strategy: 'MAXIMIZE_CLICKS' },
                  keywords: kwList.map((text) => ({ text, matchType: 'PHRASE' })),
                  negativeKeywords: [],
                  adCopy: {
                    headlines: headlines.split('\n').map((s) => s.trim()).filter(Boolean),
                    descriptions: descriptions.split('\n').map((s) => s.trim()).filter(Boolean),
                  },
                  networks: { searchPartners: false },
                  leadDestination:
                    channel === 'whatsapp'
                      ? { strategy: 's1_redirect', channel, whatsappNumber: waNumber, prefillText: prefill }
                      : { strategy: 's1_redirect', channel, igUsername: igUser, prefillText: prefill },
                },
              });
              setNotice('Draft created. Use "Propose launch" on the campaign card, then approve it in Approvals.');
              setOpen(false);
              onCreated();
            } catch (e) {
              setErr(String(e));
            } finally {
              setBusy('');
            }
          }}
        >
          Create draft
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
        <span className="muted">Draft → propose launch → approval → live. Nothing reaches Google before approval.</span>
      </div>
    </div>
  );
}

function CampaignCard({
  campaign,
  onChange,
  setNotice,
  setErr,
}: {
  campaign: AdsCampaign;
  onChange: () => void;
  setNotice: (s: string) => void;
  setErr: (s: string) => void;
}) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [tcplOut, setTcplOut] = useState('');

  useEffect(() => {
    if (['launched', 'paused'].includes(campaign.status)) adsApi.insights(campaign.id).then(setInsights).catch(() => {});
  }, [campaign.id, campaign.status]);

  const act = (fn: () => Promise<unknown>, msg: string) => async () => {
    try {
      await fn();
      setNotice(msg);
      onChange();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="card">
      <div className="row">
        <strong className="grow">{campaign.name}</strong>
        <span className={`pill ${campaign.status === 'launched' ? 'active' : campaign.status === 'paused' ? 'rejected' : 'pending'}`}>{campaign.status}</span>
        {campaign.status === 'draft' && (
          <button className="primary" onClick={act(() => adsApi.proposeLaunch(campaign.id), 'Launch proposed — approve in Approvals tab.')}>
            Propose launch
          </button>
        )}
        {campaign.status === 'launched' && (
          <button onClick={act(() => adsApi.proposeEdit(campaign.id, { action: 'pause' }), 'Pause proposed.')}>Propose pause</button>
        )}
        {campaign.status === 'paused' && (
          <button onClick={act(() => adsApi.proposeEdit(campaign.id, { action: 'resume' }), 'Resume proposed.')}>Propose resume</button>
        )}
        {['launched', 'paused'].includes(campaign.status) && (
          <button
            onClick={async () => {
              try {
                const r = await adsApi.tcplEvaluate(campaign.id);
                setTcplOut(`TCPL: ${r.evaluation.decision} — ${(r.evaluation.detail as any)?.note ?? ''}${r.proposalId ? ' (proposal queued)' : ''}`);
                onChange();
              } catch (e) {
                setErr(String(e));
              }
            }}
          >
            Run TCPL check
          </button>
        )}
      </div>
      <div className="muted">
        {campaign.budget.currency} {campaign.budget.dailyAmount}/day · ceiling {campaign.budget.hardDailyCeiling} · cap {campaign.budget.monthlyCap}/mo · target CPL {campaign.budget.targetCostPerLead}
        {campaign.leadSlug && (
          <>
            {' '}· lead link: <a href={`/r/${campaign.leadSlug}`} target="_blank" rel="noreferrer">/r/{campaign.leadSlug}</a> (click to simulate a lead)
          </>
        )}
      </div>
      {insights && (
        <div className="row muted" style={{ marginTop: 6 }}>
          <span>7d: {insights.impressions} impr</span>
          <span>{insights.clicks} clicks ({insights.clickThroughRate}% CTR)</span>
          <span>spend {insights.currency} {insights.spend}</span>
          <span><strong>{insights.leads} leads</strong></span>
          <span>CPL {insights.costPerLead ?? '—'}</span>
          <span>MTD spend {insights.monthToDateSpend}</span>
        </div>
      )}
      {tcplOut && <div className="banner">{tcplOut}</div>}
    </div>
  );
}
