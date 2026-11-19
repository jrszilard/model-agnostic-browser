import { describe, it, expect } from 'vitest';
import { Bridge } from '../src/bridge.js';
import { FakeExtension } from '../src/fake-extension.js';
import { InMemoryAuditSink } from '../src/audit.js';
import type { Observation } from '@ai-in-browser/protocol';

const observation = (over: Partial<Observation> = {}): Observation => ({
  observationId: 'o1', url: 'https://example.com', title: 'T',
  capturedAt: '2026-06-12T00:00:00.000Z',
  elements: [
    { ref: 'link', role: 'link', name: 'Pricing', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'submit', role: 'button', name: 'Submit Application', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'name', role: 'textbox', name: 'Name', bounds: { x: 0, y: 0, w: 1, h: 1 }, fieldHints: { name: 'firstName' } },
    { ref: 'pw', role: 'textbox', name: 'Password', bounds: { x: 0, y: 0, w: 1, h: 1 }, fieldHints: { inputType: 'password' } },
  ],
  textDigest: '', captchaPresent: false, ...over,
});

function makeBridge() {
  const ext = new FakeExtension();
  const audit = new InMemoryAuditSink();
  let t = 0;
  const bridge = new Bridge({ connection: ext, audit, now: () => `t${++t}`, newActionId: () => 'aid' });
  return { ext, audit, bridge };
}

async function observed() {
  const ctx = makeBridge();
  ctx.ext.nextObservation = observation();
  await ctx.bridge.observe();
  return ctx;
}

describe('observe', () => {
  it('returns and caches the extension observation', async () => {
    const { ext, bridge } = makeBridge();
    ext.nextObservation = observation();
    expect((await bridge.observe()).observationId).toBe('o1');
  });
});

describe('act — auto (no gate)', () => {
  it('navigate executes with no approval', async () => {
    const { ext, audit, bridge } = makeBridge();
    ext.nextObservation = observation();
    const r = await bridge.act({ kind: 'navigate', url: 'https://example.com/p' }, 'mcp');
    expect(r.status).toBe('executed');
    expect(ext.approvalRequests).toHaveLength(0);
    expect(ext.executed).toHaveLength(1);
    expect(audit.records).toHaveLength(1);
  });

  it('ordinary click auto-executes', async () => {
    const { ext, bridge } = await observed();
    const r = await bridge.act({ kind: 'click', ref: 'link', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('executed');
    expect(ext.approvalRequests).toHaveLength(0);
  });

  it('ordinary type auto-executes', async () => {
    const { ext, bridge } = await observed();
    const r = await bridge.act({ kind: 'type', ref: 'name', value: 'Pat', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('executed');
    expect(ext.approvalRequests).toHaveLength(0);
  });
});

describe('act — gated (high)', () => {
  it('submit click: approved -> executes, approvedBy user, audit approval approved', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'approved';
    const r = await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp');
    expect(ext.approvalRequests).toHaveLength(1);
    expect(r.status).toBe('executed');
    expect(r.approvedBy).toBe('user');
    expect(audit.records[0]).toMatchObject({ approval: { outcome: 'approved' }, result: { status: 'executed' } });
  });

  it('denied -> never executes', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'denied';
    const r = await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('denied');
    expect(ext.executed).toHaveLength(0);
    expect(audit.records[0]).toMatchObject({ approval: { outcome: 'denied' }, result: { status: 'denied' } });
  });

  it('timeout -> denied, never executes', async () => {
    const { ext, bridge } = await observed();
    ext.approval = 'timeout';
    const r = await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('denied');
    expect(ext.executed).toHaveLength(0);
  });
});

describe('act — sensitive type gated AND redacted in audit', () => {
  it('password type requires approval; audit redacts the value', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'approved';
    await bridge.act({ kind: 'type', ref: 'pw', value: 'hunter2', observationId: 'o1' }, 'mcp');
    expect(ext.approvalRequests).toHaveLength(1);
    const json = JSON.stringify(audit.records);
    expect(json).not.toContain('hunter2');
    expect(json).toContain('[redacted]');
  });
});

describe('act — stale ref (fail closed, never executes)', () => {
  it('unknown observationId -> stale_ref', async () => {
    const { ext, audit, bridge } = await observed();
    const r = await bridge.act({ kind: 'click', ref: 'link', observationId: 'OLD' }, 'mcp');
    expect(r.status).toBe('stale_ref');
    expect(ext.executed).toHaveLength(0);
    expect(audit.records).toHaveLength(1);
  });

  it('unknown ref in the current observation -> stale_ref', async () => {
    const { ext, bridge } = await observed();
    const r = await bridge.act({ kind: 'click', ref: 'ghost', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('stale_ref');
    expect(ext.executed).toHaveLength(0);
  });
});

describe('structural invariants', () => {
  it('writes exactly one audit record per act, on every outcome', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'denied';
    await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp'); // denied
    ext.approval = 'approved';
    await bridge.act({ kind: 'click', ref: 'link', observationId: 'o1' }, 'mcp');   // executed
    await bridge.act({ kind: 'click', ref: 'ghost', observationId: 'o1' }, 'mcp');  // stale
    expect(audit.records).toHaveLength(3);
  });
});

describe('act — execute-time outcomes', () => {
  it('extension returns stale_ref at execute time -> stale_ref (execute was attempted)', async () => {
    const { ext, audit, bridge } = await observed();
    ext.exec = { status: 'stale_ref' };
    const r = await bridge.act({ kind: 'click', ref: 'link', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('stale_ref');
    expect(ext.executed).toHaveLength(1); // distinct from the pre-check stale path (which never executes)
    expect(audit.records).toHaveLength(1);
  });

  it('extension returns error -> error status + error propagated and audited (ordinary action)', async () => {
    const { ext, audit, bridge } = await observed();
    ext.exec = { status: 'error', error: 'boom' };
    const r = await bridge.act({ kind: 'click', ref: 'link', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('error');
    expect(r.error).toBe('boom');
    expect((audit.records[0] as { result: { error?: string } }).result.error).toBe('boom');
  });
});

describe('act — audit never leaks a secret via the error string', () => {
  it('redacts a high-risk execute error in the audit', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'approved';
    ext.exec = { status: 'error', error: 'rejected password hunter2' };
    const r = await bridge.act({ kind: 'type', ref: 'pw', value: 'hunter2', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('error');
    const json = JSON.stringify(audit.records);
    expect(json).not.toContain('hunter2'); // neither the typed value nor the echoed error
  });
});

describe('act — timeout is recorded distinctly in the audit', () => {
  it('approval timeout -> denied status but audit approval outcome is "timeout"', async () => {
    const { ext, audit, bridge } = await observed();
    ext.approval = 'timeout';
    const r = await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('denied');
    expect((audit.records[0] as { approval?: { outcome: string } }).approval?.outcome).toBe('timeout');
    expect(ext.executed).toHaveLength(0);
  });
});

describe('act — no_match with availableOptions', () => {
  it('select no_match returns availableOptions and writes one audit event', async () => {
    const fake = new FakeExtension();
    const audit = new InMemoryAuditSink();
    const bridge = new Bridge({ connection: fake, audit, now: () => 'T', newActionId: () => 'a1' });

    fake.nextObservation = {
      observationId: 'o1', url: 'https://x', title: 't', capturedAt: 'T',
      captchaPresent: false, textDigest: '',
      elements: [{ ref: 'e1', role: 'combobox', name: 'Country', bounds: { x: 0, y: 0, w: 1, h: 1 }, widget: 'combobox' }],
    };
    await bridge.observe();
    fake.exec = { status: 'no_match', availableOptions: ['United States', 'Canada'] };

    const r = await bridge.act({ kind: 'select', ref: 'e1', option: 'USA', observationId: 'o1' }, 'mcp');

    expect(r.status).toBe('no_match');
    expect(r.availableOptions).toEqual(['United States', 'Canada']);
    expect(audit.records).toHaveLength(1);
    expect((audit.records[0] as { result: { status: string } }).result.status).toBe('no_match');
    // availableOptions must NOT appear in the audit record
    expect(JSON.stringify(audit.records)).not.toContain('availableOptions');
  });
});
