import type { Observation, BrowserAction } from '@ai-in-browser/protocol';
import type {
  ExtensionConnection, ExecOutcome, ApprovalRequest, ApprovalOutcome, HandoffOutcome,
} from './connection.js';

/** Scriptable in-memory ExtensionConnection for tests and the conformance battery. */
export class FakeExtension implements ExtensionConnection {
  nextObservation: Observation | null = null;
  approval: ApprovalOutcome = 'approved';
  handoff: HandoffOutcome = 'continued';
  exec: ExecOutcome = { status: 'executed' };

  readonly executed: BrowserAction[] = [];
  readonly approvalRequests: ApprovalRequest[] = [];
  readonly handoffReasons: string[] = [];

  async observe(): Promise<Observation> {
    if (!this.nextObservation) throw new Error('FakeExtension: set nextObservation first');
    return this.nextObservation;
  }

  async execute(action: BrowserAction): Promise<ExecOutcome> {
    this.executed.push(action);
    return this.exec;
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    this.approvalRequests.push(req);
    return this.approval;
  }

  async requestHandoff(reason: string): Promise<HandoffOutcome> {
    this.handoffReasons.push(reason);
    return this.handoff;
  }
}
