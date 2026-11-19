// 'blocked' is the reserved CAPTCHA / anti-bot tier: never produced by classify() in
// slice 1 (the bridge detects CAPTCHA via observe and routes to await_human). Kept so the
// tier is enforceable from day one.
export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';
export interface ElementRef {
  ref: string; role: string; name: string;
  bounds: { x: number; y: number; w: number; h: number };
  fieldHints?: { inputType?: string; autocomplete?: string; name?: string };
  options?: string[];                                   // populated ONLY for native_select
  widget?: 'native_select' | 'combobox' | 'typeahead';  // slice 2a: dropdown kind
  value?: string;                                        // slice 2a: current displayed value
  required?: boolean;                                    // slice 2b: field is required (aria-required / native / label '*')
}
export interface Observation {
  observationId: string; url: string; title: string; capturedAt: string;
  elements: ElementRef[]; textDigest: string; captchaPresent: boolean;
}
export type BrowserAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; ref: string; observationId: string }
  | { kind: 'type'; ref: string; value: string; observationId: string }
  | { kind: 'select'; ref: string; option: string; observationId: string };
export interface PolicyDecision {
  risk: RiskLevel;
  requiresApproval: boolean;
  blocked: boolean; // true only for the reserved 'blocked' tier (handoff; never executed)
  reason: string;
}
export type ActionStatus = 'executed' | 'denied' | 'blocked' | 'stale_ref' | 'error' | 'no_match';
export interface ActionResult {
  actionId: string; status: ActionStatus; decision: PolicyDecision;
  approvedBy?: 'user'; observation?: Observation; error?: string;
  availableOptions?: string[];   // slice 2a: present on 'no_match' so the AI retries with a real value
}
export interface AuditEvent {
  ts: string; clientId: string; url: string; observationId: string;
  action: BrowserAction; decision: PolicyDecision;
  approval?: { outcome: 'approved' | 'denied' | 'timeout'; at: string };
  result: { status: ActionStatus; error?: string };
}
export interface HandoffEvent {
  ts: string; clientId: string; url: string; reason: string;
  outcome: 'continued' | 'took_over' | 'timeout';
}
