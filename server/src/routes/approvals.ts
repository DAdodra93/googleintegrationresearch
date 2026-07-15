import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import type { ApprovalStatus } from '../core/store/types.js';

/**
 * Actions whose execution spends OUR money or touches platform-level
 * infrastructure — only the operator may decide them. Everything else
 * (their campaigns, their profile content) is decidable by the merchant
 * that owns it.
 */
const OPERATOR_ONLY_ACTIONS = new Set(['ads.account.provision']);

export function registerApprovalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/approvals', async (req) => {
    const { merchantId, status } = req.query as { merchantId?: string; status?: ApprovalStatus };
    const scope = await ctx.authz.merchantScope(req);
    if (scope === 'all') return ctx.approvals.list({ merchantId, status });
    if (merchantId) {
      await ctx.authz.assertMerchant(req, merchantId);
      return ctx.approvals.list({ merchantId, status });
    }
    const lists = await Promise.all(scope.map((mid) => ctx.approvals.list({ merchantId: mid, status })));
    return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  const decide = (decision: 'approved' | 'rejected') => async (req: any) => {
    const { id } = req.params as { id: string };
    const approval = await ctx.approvals.get(id);
    if (!approval) throw Object.assign(new Error('approval not found'), { statusCode: 404 });
    const user = await ctx.authz.assertMerchant(req, approval.merchantId);
    if (OPERATOR_ONLY_ACTIONS.has(approval.actionType)) ctx.authz.requireOperator(req);
    return ctx.approvals.decide(id, decision, user.email);
  };

  app.post('/api/approvals/:id/approve', decide('approved'));
  app.post('/api/approvals/:id/reject', decide('rejected'));
}
