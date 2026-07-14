import type { Approval, Module, Store } from '../store/types.js';

export type ApprovalExecutor = (approval: Approval) => Promise<void>;

/**
 * Generic propose-then-approve engine (shared infrastructure). Every external,
 * money-moving, or irreversible action in either module MUST pass through
 * here: modules propose (with a typed payload + human-readable summary),
 * the operator/merchant decides in the console, and only approval triggers
 * the registered executor. Nothing auto-sends.
 */
export class ApprovalService {
  private executors = new Map<string, ApprovalExecutor>();

  constructor(private store: Store) {}

  registerExecutor(actionType: string, executor: ApprovalExecutor): void {
    if (this.executors.has(actionType)) throw new Error(`executor already registered for ${actionType}`);
    this.executors.set(actionType, executor);
  }

  async propose(input: {
    merchantId: string;
    module: Module;
    actionType: string;
    payload: unknown;
    summary: string;
    proposedBy?: string;
  }): Promise<Approval> {
    if (!this.executors.has(input.actionType)) {
      throw new Error(`no executor registered for action type "${input.actionType}"`);
    }
    const approval = await this.store.createApproval({ ...input, proposedBy: input.proposedBy ?? 'ai' });
    await this.store.audit({
      merchantId: input.merchantId,
      module: input.module,
      event: 'approval.proposed',
      detail: { id: approval.id, actionType: input.actionType },
    });
    return approval;
  }

  async decide(id: string, decision: 'approved' | 'rejected', decidedBy: string): Promise<Approval> {
    const approval = await this.store.getApproval(id);
    if (!approval) throw new Error(`approval ${id} not found`);
    if (approval.status !== 'pending') throw new Error(`approval ${id} is ${approval.status}, not pending`);

    const decided = await this.store.updateApproval(id, {
      status: decision,
      decidedBy,
      decidedAt: new Date().toISOString(),
    });
    await this.store.audit({
      merchantId: approval.merchantId,
      module: approval.module,
      event: `approval.${decision}`,
      detail: { id, actionType: approval.actionType, decidedBy },
    });
    if (decision === 'rejected') return decided;

    const executor = this.executors.get(approval.actionType);
    if (!executor) throw new Error(`no executor registered for ${approval.actionType}`);
    try {
      await executor(decided);
      const executed = await this.store.updateApproval(id, { status: 'executed', executedAt: new Date().toISOString() });
      await this.store.audit({
        merchantId: approval.merchantId,
        module: approval.module,
        event: 'approval.executed',
        detail: { id, actionType: approval.actionType },
      });
      return executed;
    } catch (err) {
      const failed = await this.store.updateApproval(id, { status: 'failed', error: String(err) });
      await this.store.audit({
        merchantId: approval.merchantId,
        module: approval.module,
        event: 'approval.failed',
        detail: { id, actionType: approval.actionType, error: String(err) },
      });
      return failed;
    }
  }

  list(filter?: Parameters<Store['listApprovals']>[0]) {
    return this.store.listApprovals(filter);
  }
}
