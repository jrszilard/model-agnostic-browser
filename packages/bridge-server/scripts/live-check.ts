/**
 * Gated real-Brave live check. Run with the extension loaded in Brave:
 *   corepack pnpm exec tsx packages/bridge-server/scripts/live-check.ts
 * Drives the full safe loop against the local test form. NEVER part of pnpm test.
 */
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Bridge, BridgeWsServer, JsonlAuditSink } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FORM    = join(here, '../../extension/testpage/form.html');
const COMBOBOX = join(here, '../../extension/testpage/combobox.html');
const AUDIT = join(here, '../../../live-check.audit.jsonl');
const PAGE_PORT = 8788;
const SECRET = 'live-check-secret-42';

async function main(): Promise<void> {
  await rm(AUDIT, { force: true });

  const pages = createServer(async (req, res) => {
    res.setHeader('content-type', 'text/html');
    const isCombobox = req.url?.includes('combobox');
    res.end(await readFile(isCombobox ? COMBOBOX : FORM));
  }).listen(PAGE_PORT, '127.0.0.1');

  const server = new BridgeWsServer({});
  await server.listen();
  console.log('bridge listening on ws://127.0.0.1:8765 — waiting for the extension…');
  const conn = await server.waitForConnection();
  console.log('extension connected.');

  const bridge = new Bridge({ connection: conn, audit: new JsonlAuditSink(AUDIT) });
  const step = async (label: string, p: Promise<{ status?: string; outcome?: string }>) => {
    const r = await p;
    console.log(`  ${label}: ${r.status ?? r.outcome}`);
    return r;
  };

  // Every action must cite the LATEST observation: each executed action returns a
  // fresh post-action snapshot, so an older observationId is (correctly) stale.
  const find = (o: Awaited<ReturnType<typeof bridge.observe>>, m: RegExp) => {
    const el = o.elements.find((e) => m.test(e.name));
    if (!el) throw new Error(`no element matching ${m}`);
    return el;
  };
  const actFresh = async (label: string, mk: (o: Awaited<ReturnType<typeof bridge.observe>>) =>
    Parameters<typeof bridge.act>[0]) => {
    const o = await bridge.observe();
    return step(label, bridge.act(mk(o), 'live-check'));
  };

  console.log('\n1) navigate + observe (low -> auto)');
  await step('navigate', bridge.act({ kind: 'navigate', url: `http://127.0.0.1:${PAGE_PORT}/form.html` }, 'live-check'));
  const obs = await bridge.observe();
  console.log(`  observed ${obs.elements.length} elements on "${obs.title}"`);

  console.log('\n2) fill ordinary fields (medium -> auto, NO overlay should appear)');
  await actFresh('type name', (o) => ({ kind: 'type', ref: find(o, /full name/i).ref, value: 'Pat Example', observationId: o.observationId }));
  await actFresh('type email', (o) => ({ kind: 'type', ref: find(o, /email/i).ref, value: 'pat@example.com', observationId: o.observationId }));
  await actFresh('type message', (o) => ({ kind: 'type', ref: find(o, /message/i).ref, value: 'Hello from the live check.', observationId: o.observationId }));

  console.log('\n3) select country (medium -> auto)');
  const o3 = await bridge.observe();
  const country = find(o3, /country/i);
  console.log(`  options surfaced: ${JSON.stringify(country.options)}`);
  await step('select', bridge.act({ kind: 'select', ref: country.ref, option: 'United States', observationId: o3.observationId }, 'live-check'));

  console.log('\n4) sensitive type (high -> OVERLAY appears; please APPROVE it)');
  await actFresh('type password', (o) => ({ kind: 'type', ref: find(o, /password/i).ref, value: SECRET, observationId: o.observationId }));

  console.log('\n5) submit click (high -> OVERLAY appears; please DENY it — never auto-submit)');
  await actFresh('click submit', (o) => ({ kind: 'click', ref: find(o, /submit/i).ref, observationId: o.observationId }));

  console.log('\n6) proactive handoff (overlay; click Continue)');
  await step('await_human', bridge.awaitHuman('review the filled form — your turn', 'live-check'));

  console.log('\n7) audit redaction check');
  const audit = await readFile(AUDIT, 'utf8');
  if (audit.includes(SECRET)) throw new Error('FAIL: sensitive value leaked into the audit log!');
  if (!audit.includes('[redacted]')) throw new Error('FAIL: no [redacted] marker in the audit log');
  console.log(`  OK — ${audit.trim().split('\n').length} audit lines, secret redacted.`);

  // ── Combobox scenario (slice-2a) ──────────────────────────────────────────
  console.log('\n8) navigate to combobox fixture');
  await step('navigate', bridge.act({ kind: 'navigate', url: `http://127.0.0.1:${PAGE_PORT}/combobox.html` }, 'live-check'));
  const obsCb = await bridge.observe();
  console.log(`  observed ${obsCb.elements.length} elements on "${obsCb.title}"`);

  console.log('\n9) select Canada from the custom Country combobox (expect executed)');
  const o9 = await bridge.observe();
  const countryCb = o9.elements.find((e) => /country/i.test(e.name));
  if (!countryCb) throw new Error('combobox fixture: Country combobox not found in observation');
  const r9 = await step('select Canada', bridge.act({ kind: 'select', ref: countryCb.ref, option: 'Canada', observationId: o9.observationId }, 'live-check'));
  console.log(`  (status was: ${(r9 as { status?: string }).status})`);

  console.log('\n10) select deliberate miss "Atlantis" on Country combobox (expect no_match + availableOptions)');
  const o10 = await bridge.observe();
  const countryCb10 = o10.elements.find((e) => /country/i.test(e.name));
  if (!countryCb10) throw new Error('combobox fixture: Country combobox not found after step 9');
  const r10 = await step('select Atlantis', bridge.act({ kind: 'select', ref: countryCb10.ref, option: 'Atlantis', observationId: o10.observationId }, 'live-check'));
  console.log(`  availableOptions: ${JSON.stringify((r10 as { availableOptions?: string[] }).availableOptions ?? [])}`);
  if (!((r10 as { availableOptions?: string[] }).availableOptions?.length)) throw new Error('expected availableOptions on no_match');

  console.log('\n11) select "Yes" on the bounded Authorization React-Select (expect executed)');
  const o11 = await bridge.observe();
  const authCb = o11.elements.find((e) => /authorized to work/i.test(e.name));
  if (!authCb) throw new Error('combobox fixture: Authorization combobox not found');
  if (authCb.required !== true) throw new Error('expected required:true on the Authorization combobox');
  const r11 = await step('select Yes', bridge.act({ kind: 'select', ref: authCb.ref, option: 'Yes', observationId: o11.observationId }, 'live-check'));
  if ((r11 as { status?: string }).status !== 'executed') throw new Error(`expected executed, got ${(r11 as { status?: string }).status}`);

  console.log('\n12) select "MIT" on the School type-ahead (expect executed — grounded value now fills)');
  const o12 = await bridge.observe();
  const schoolCb = o12.elements.find((e) => /school/i.test(e.name));
  if (!schoolCb) throw new Error('combobox fixture: School typeahead not found');
  const r12 = await step('select MIT (typeahead)', bridge.act({ kind: 'select', ref: schoolCb.ref, option: 'MIT', observationId: o12.observationId }, 'live-check'));
  if ((r12 as { status?: string }).status !== 'executed') throw new Error(`expected executed, got ${(r12 as { status?: string }).status}`);

  console.log('\nLIVE CHECK COMPLETE.');
  pages.close();
  await server.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
