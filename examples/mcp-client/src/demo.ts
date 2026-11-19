/**
 * GATED demo: drives the two slice-1 flows through the real MCP adapter in real Brave.
 * Run: corepack pnpm exec tsx examples/mcp-client/src/demo.ts   (load the extension in Brave first)
 *
 * Demo 1 (navigate + read): navigate to the local form, observe, list the fields.
 * Demo 2 (headline): fill name/email/message + select country (all auto), type the
 *   password (high -> APPROVE), click Submit (high -> DENY: never auto-submit),
 *   then a proactive await_human (CONTINUE). Finally assert the audit redacted the secret.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const FORM = resolve(repoRoot, 'packages/extension/testpage/form.html');
const ADAPTER = resolve(repoRoot, 'packages/adapter-mcp/src/main.ts');
const AUDIT = resolve(repoRoot, 'adapter-mcp-demo.audit.jsonl');
const PAGE_PORT = 8799;
const SECRET = 'demo-secret-77';

type Content = { content: { text: string }[]; isError?: boolean };
const findRef = (observeText: string, re: RegExp): { ref: string; observationId: string } => {
  const o = JSON.parse(observeText) as { observationId: string; elements: { ref: string; name: string }[] };
  const el = o.elements.find((e) => re.test(e.name));
  if (!el) throw new Error(`no element matching ${re}`);
  return { ref: el.ref, observationId: o.observationId };
};

async function main(): Promise<void> {
  const pages = createServer(async (_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(await readFile(FORM));
  }).listen(PAGE_PORT, '127.0.0.1');

  const transport = new StdioClientTransport({
    command: 'corepack',
    args: ['pnpm', 'exec', 'tsx', ADAPTER],
    cwd: repoRoot,
    env: { ...process.env, AIB_AUDIT: AUDIT },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (c) => process.stderr.write(`[adapter] ${c}`));

  const client = new Client({ name: 'ai-in-browser-demo', version: '0.0.1' });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Content> => {
    const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 130_000 })) as Content;
    console.log(`\n=== ${name}(${JSON.stringify(args)}) ===\n${r.content.map((c) => c.text).join('\n')}`);
    return r;
  };

  // --- Demo 1: navigate + read ---
  console.log('\n##### DEMO 1: navigate + read #####');
  await call('browser_navigate', { url: `http://127.0.0.1:${PAGE_PORT}/form.html` });
  await call('browser_observe');

  // --- Demo 2: fill the form, stop at Submit ---
  console.log('\n##### DEMO 2: fill a form, stop at Submit #####');
  let obs = (await call('browser_observe')).content[0].text;
  const name = findRef(obs, /full name/i);
  await call('browser_type', { ...name, value: 'Pat Example' });

  obs = (await call('browser_observe')).content[0].text;
  await call('browser_type', { ...findRef(obs, /email/i), value: 'pat@example.com' });

  obs = (await call('browser_observe')).content[0].text;
  await call('browser_type', { ...findRef(obs, /message/i), value: 'Hello from the MCP demo.' });

  obs = (await call('browser_observe')).content[0].text;
  await call('browser_select', { ...findRef(obs, /country/i), option: 'United States' });

  console.log('\n>>> APPROVE the password overlay in Brave (blue button).');
  obs = (await call('browser_observe')).content[0].text;
  await call('browser_type', { ...findRef(obs, /password/i), value: SECRET });

  console.log('\n>>> DENY the Submit overlay in Brave (gray button) — never auto-submit.');
  obs = (await call('browser_observe')).content[0].text;
  const submit = await call('browser_click', { ...findRef(obs, /submit/i) });
  if (!submit.content[0].text.includes('status: denied')) {
    console.warn('  NOTE: expected status: denied (deny the Submit overlay).');
  }

  console.log('\n>>> CONTINUE the handoff overlay in Brave.');
  await call('browser_await_human', { reason: 'review the filled form — your turn' });

  const audit = await readFile(AUDIT, 'utf8');
  if (audit.includes(SECRET)) throw new Error('FAIL: the sensitive value leaked into the audit log!');
  if (!audit.includes('[redacted]')) throw new Error('FAIL: no [redacted] marker in the audit log');
  console.log(`\nDEMO COMPLETE — ${audit.trim().split('\n').length} audit lines, secret redacted.`);

  await client.close();
  pages.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
