import type { Observation, BrowserAction, ElementRef, PolicyDecision } from '@ai-in-browser/protocol';

export interface ApprovalRequest {
  action: BrowserAction;
  decision: PolicyDecision;
  target?: ElementRef;
}

export type ApprovalOutcome = 'approved' | 'denied' | 'timeout';
export type HandoffOutcome = 'continued' | 'took_over' | 'timeout';

export interface ExecOutcome {
  status: 'executed' | 'stale_ref' | 'error' | 'no_match';
  observation?: Observation;
  error?: string;
  availableOptions?: string[];
}

/**
 * The bridge's view of the extension. The real implementation wraps a WebSocket
 * (Plan 3); FakeExtension implements it in-memory for the conformance battery.
 */
export interface ExtensionConnection {
  observe(): Promise<Observation>;
  execute(action: BrowserAction): Promise<ExecOutcome>;
  requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome>;
  requestHandoff(reason: string): Promise<HandoffOutcome>;
}
