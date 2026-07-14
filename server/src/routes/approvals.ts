import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import type { ApprovalStatus } from '../core/store/types.js';

const Decision = z.object({ decidedBy: z.string().min(1).default('operator') });

export function registerApprovalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/approvals', async (req) => {
    const { merchantId, status } = req.query as { merchantId?: string; status?: ApprovalStatus };
    return ctx.approvals.list({ merchantId, status });
  });

  app.post('/api/approvals/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const { decidedBy } = Decision.parse(req.body ?? {});
    return ctx.approvals.decide(id, 'approved', decidedBy);
  });

  app.post('/api/approvals/:id/reject', async (req) => {
    const { id } = req.params as { id: string };
    const { decidedBy } = Decision.parse(req.body ?? {});
    return ctx.approvals.decide(id, 'rejected', decidedBy);
  });
}
