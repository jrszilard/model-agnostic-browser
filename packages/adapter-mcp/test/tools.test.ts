import { describe, it, expect } from 'vitest';
import { Bridge, FakeExtension, InMemoryAuditSink } from '@ai-in-browser/bridge-server';
import type { Observation } from '@ai-in-browser/protocol';
import { runObserve, runNavigate, runClick, runType, runSelect, runAwaitHuman } from '../src/tools.js';

const CID = 'test';

const obs = (over: Partial<Observation> = {}): Observation => ({
  observationId: 'o1',
  url: 'http://127.0.0.1/form',
  title: 'Form',
  capturedAt: '2026-06-15T00:00:00.000Z',
  elements: [
    { ref: 'e1', role: 'textbox', name: 'Full name', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'e2', role: 'textbox', name: 'Account password', bounds: { x: 0, y: 0, w: 1, h: 1 }, fieldHints: { inputType: 'password' } },
    { ref: 'e3', role: 'button', name: 'Submit Application', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'e4', role: 'combobox', name: 'Country', bounds: { x: 0, y: 0, w: 1, h: 1 }, options: ['United States', 'Germany'] },
  ],
  textDigest: 'a form',
  captchaPresent: false,
  ...over,
});

function setup(): { bridge: Bridge; fake: FakeExtension; audit: InMemoryAuditSink } {
  const fake = new FakeExtension();
  fake.nextObservation = obs();
  fake.exec = { status: 'executed', observation: obs() };
  const audit = new InMemoryAuditSink();
  const bridge = new Bridge({ connection: fake, audit });
  return { bridge, fake, audit };
}

describe('runObserve', () => {
  it('returns the formatted current observation', async () => {
    const { bridge } = setup();
    const r = await runObserve(bridge);
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('"observationId": "o1"');
  });
});

describe('runNavigate', () => {
  it('issues a navigate action (low -> auto) and reports executed', async () => {
    const { bridge, fake } = setup();
    const r = await runNavigate(bridge, { url: 'http://127.0.0.1/form' }, CID);
    expect(fake.executed.at(-1)).toEqual({ kind: 'navigate', url: 'http://127.0.0.1/form' });
    expect(r.content[0].text).toContain('status: executed');
    expect(r.isError).toBeUndefined();
  });
});

describe('runType', () => {
  it('ordinary field is medium -> auto-executes with NO approval request', async () => {
    const { bridge, fake } = setup();
    await bridge.observe();
    const r = await runType(bridge, { ref: 'e1', value: 'Pat', observationId: 'o1' }, CID);
    expect(fake.approvalRequests).toHaveLength(0);
    expect(fake.executed.at(-1)).toEqual({ kind: 'type', ref: 'e1', value: 'Pat', observationId: 'o1' });
    expect(r.content[0].text).toContain('status: executed');
  });

  it('sensitive (password) field is high -> raises an approval request; deny -> denied', async () => {
    const { bridge, fake } = setup();
    fake.approval = 'denied';
    await bridge.observe();
    const r = await runType(bridge, { ref: 'e2', value: 'secret', observationId: 'o1' }, CID);
    expect(fake.approvalRequests).toHaveLength(1);
    expect(r.content[0].text).toContain('status: denied');
    expect(r.isError).toBeUndefined();
  });
});

describe('runClick', () => {
  it('Submit button is high -> gated; deny -> denied and never executed', async () => {
    const { bridge, fake } = setup();
    fake.approval = 'denied';
    await bridge.observe();
    const r = await runClick(bridge, { ref: 'e3', observationId: 'o1' }, CID);
    expect(fake.approvalRequests).toHaveLength(1);
    expect(fake.executed.some((a) => a.kind === 'click')).toBe(false);
    expect(r.content[0].text).toContain('status: denied');
  });

  it('a stale observationId maps to stale_ref (AI must re-observe)', async () => {
    const { bridge } = setup();
    await bridge.observe();
    const r = await runClick(bridge, { ref: 'e3', observationId: 'STALE' }, CID);
    expect(r.content[0].text).toContain('status: stale_ref');
  });
});

describe('runSelect', () => {
  it('native select is medium -> auto-executes', async () => {
    const { bridge, fake } = setup();
    await bridge.observe();
    const r = await runSelect(bridge, { ref: 'e4', option: 'United States', observationId: 'o1' }, CID);
    expect(fake.approvalRequests).toHaveLength(0);
    expect(fake.executed.at(-1)).toEqual({ kind: 'select', ref: 'e4', option: 'United States', observationId: 'o1' });
    expect(r.content[0].text).toContain('status: executed');
  });
});

describe('error mapping', () => {
  it('an execution error maps to isError: true', async () => {
    const { bridge, fake } = setup();
    fake.exec = { status: 'error', error: 'not clickable' };
    await bridge.observe();
    const r = await runType(bridge, { ref: 'e1', value: 'x', observationId: 'o1' }, CID);
    expect(r.content[0].text).toContain('status: error');
    expect(r.isError).toBe(true);
  });
});

describe('runAwaitHuman', () => {
  it('passes the reason through and reports the outcome', async () => {
    const { bridge, fake } = setup();
    fake.handoff = 'continued';
    const r = await runAwaitHuman(bridge, { reason: 'your turn' }, CID);
    expect(fake.handoffReasons).toEqual(['your turn']);
    expect(r.content[0].text).toContain('outcome: continued');
  });
});
