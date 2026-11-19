import {
  classify, redactAction,
  type Observation, type BrowserAction, type ElementRef,
  type ActionResult, type ActionStatus, type AuditEvent, type HandoffEvent,
  type PolicyDecision,
} from '@ai-in-browser/protocol';
import type { ExtensionConnection } from './connection.js';
import type { AuditSink } from './audit.js';

export interface BridgeOptions {
  connection: ExtensionConnection;
  audit: AuditSink;
  now?: () => string;          // ISO timestamp; injectable for deterministic tests
  newActionId?: () => string;  // injectable for deterministic tests
}

type Outcome = {
  status: ActionStatus;
  approval?: AuditEvent['approval'];
  observation?: Observation;
  error?: string;
  availableOptions?: string[];
};

export class Bridge {
  private readonly conn: ExtensionConnection;
  private readonly audit: AuditSink;
  private readonly now: () => string;
  private readonly newActionId: () => string;
  private last: Observation | null = null;
  private idCounter = 0;

  constructor(opts: BridgeOptions) {
    this.conn = opts.connection;
    this.audit = opts.audit;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.newActionId = opts.newActionId ?? (() => `a${++this.idCounter}`);
  }

  async observe(): Promise<Observation> {
    const obs = await this.conn.observe();
    this.last = obs;
    return obs;
  }

  async act(action: BrowserAction, clientId: string): Promise<ActionResult> {
    const actionId = this.newActionId();
    const target = this.resolveTarget(action);
    const stale = this.needsRef(action) && !target;
    // A stale ref never reaches policy/gate/execute, so give the audit a coherent
    // decision instead of classify(undefined)'s fail-closed "high/requiresApproval".
    const decision: PolicyDecision = stale
      ? { risk: 'low', requiresApproval: false, blocked: false, reason: 'stale ref — re-observe' }
      : classify(action, target);

    const outcome = await this.run(action, decision, stale, target);

    // Never let a sensitive value reach the persisted audit via an error string.
    const auditError =
      outcome.error === undefined
        ? undefined
        : decision.risk === 'high'
          ? 'execute failed'
          : outcome.error;

    const auditEvent: AuditEvent = {
      ts: this.now(),
      clientId,
      url: this.last?.url ?? '',
      observationId: this.observationIdOf(action),
      action: redactAction(action, decision),
      decision,
      ...(outcome.approval ? { approval: outcome.approval } : {}),
      result: { status: outcome.status, ...(auditError !== undefined ? { error: auditError } : {}) },
    };
    await this.audit.append(auditEvent);

    return {
      actionId,
      status: outcome.status,
      decision,
      ...(outcome.approval?.outcome === 'approved' ? { approvedBy: 'user' as const } : {}),
      ...(outcome.observation ? { observation: outcome.observation } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      ...(outcome.availableOptions ? { availableOptions: outcome.availableOptions } : {}),
    };
  }

  private async run(
    action: BrowserAction,
    decision: PolicyDecision,
    stale: boolean,
    target: ElementRef | undefined,
  ): Promise<Outcome> {
    if (stale) return { status: 'stale_ref' };
    if (decision.blocked) return { status: 'blocked' };
    if (decision.requiresApproval) {
      const o = await this.conn.requestApproval({ action, decision, target });
      if (o !== 'approved') {
        return { status: 'denied', approval: { outcome: o === 'timeout' ? 'timeout' : 'denied', at: this.now() } };
      }
      const exec = await this.conn.execute(action);
      if (exec.status === 'executed' && exec.observation) this.last = exec.observation;
      return {
        status: exec.status,
        approval: { outcome: 'approved', at: this.now() },
        observation: exec.observation,
        error: exec.error,
        availableOptions: exec.availableOptions,
      };
    }
    const exec = await this.conn.execute(action);
    if (exec.status === 'executed' && exec.observation) this.last = exec.observation;
    return { status: exec.status, observation: exec.observation, error: exec.error, availableOptions: exec.availableOptions };
  }

  async awaitHuman(reason: string, clientId: string): Promise<HandoffEvent> {
    const outcome = await this.conn.requestHandoff(reason);
    const event: HandoffEvent = {
      ts: this.now(),
      clientId,
      url: this.last?.url ?? '',
      reason,
      outcome,
    };
    await this.audit.append(event);
    return event;
  }

  private needsRef(action: BrowserAction): boolean {
    return action.kind !== 'navigate';
  }

  private observationIdOf(action: BrowserAction): string {
    return action.kind === 'navigate' ? (this.last?.observationId ?? '') : action.observationId;
  }

  private resolveTarget(action: BrowserAction): ElementRef | undefined {
    if (action.kind === 'navigate') return undefined;
    const obs = this.last;
    if (!obs || obs.observationId !== action.observationId) return undefined; // stale page
    return obs.elements.find((e) => e.ref === action.ref);
  }
}
