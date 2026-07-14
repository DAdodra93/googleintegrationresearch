import { describe, expect, it } from 'vitest';
import { ApprovalService } from '../src/core/approvals/service.js';
import { MemoryStore } from '../src/core/store/memory.js';

async function setup() {
  const store = new MemoryStore();
  const merchant = await store.createMerchant({ name: 'Test Cafe', countryCode: 'IN', currencyCode: 'INR' });
  const approvals = new ApprovalService(store);
  return { store, merchant, approvals };
}

describe('propose-then-approve pipeline', () => {
  it('refuses to propose an action with no registered executor', async () => {
    const { merchant, approvals } = await setup();
    await expect(
      approvals.propose({ merchantId: merchant.id, module: 'gbp', actionType: 'nope', payload: {}, summary: 's' }),
    ).rejects.toThrow(/no executor/);
  });

  it('runs executor only on approval', async () => {
    const { merchant, approvals } = await setup();
    let executed = 0;
    approvals.registerExecutor('gbp.post.publish', async () => {
      executed++;
    });
    const a = await approvals.propose({
      merchantId: merchant.id,
      module: 'gbp',
      actionType: 'gbp.post.publish',
      payload: { text: 'hello' },
      summary: 'Publish post',
    });
    expect(a.status).toBe('pending');
    expect(executed).toBe(0);

    const done = await approvals.decide(a.id, 'approved', 'operator');
    expect(done.status).toBe('executed');
    expect(executed).toBe(1);
  });

  it('rejection never executes; decided approvals cannot be re-decided', async () => {
    const { merchant, approvals } = await setup();
    let executed = 0;
    approvals.registerExecutor('ads.campaign.launch', async () => {
      executed++;
    });
    const a = await approvals.propose({
      merchantId: merchant.id,
      module: 'ads',
      actionType: 'ads.campaign.launch',
      payload: {},
      summary: 'Launch',
    });
    const rejected = await approvals.decide(a.id, 'rejected', 'operator');
    expect(rejected.status).toBe('rejected');
    expect(executed).toBe(0);
    await expect(approvals.decide(a.id, 'approved', 'operator')).rejects.toThrow(/not pending/);
  });

  it('executor failure marks approval failed with the error', async () => {
    const { merchant, approvals } = await setup();
    approvals.registerExecutor('gbp.review.reply', async () => {
      throw new Error('quota exceeded');
    });
    const a = await approvals.propose({
      merchantId: merchant.id,
      module: 'gbp',
      actionType: 'gbp.review.reply',
      payload: {},
      summary: 'Reply',
    });
    const failed = await approvals.decide(a.id, 'approved', 'operator');
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('quota exceeded');
  });
});
