/**
 * Real stdio entry for the ai-in-browser MCP adapter. Launched by an MCP client
 * (Claude Code / Cursor / the demo). Starts the bridge WS server (the extension
 * connects to it), then serves the MCP protocol over stdio.
 *
 * STDOUT IS THE MCP CHANNEL — every diagnostic goes to STDERR.
 */
import { BridgeWsServer, JsonlAuditSink } from '@ai-in-browser/bridge-server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeSession } from './session.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const auditPath = process.env.AIB_AUDIT ?? 'adapter-mcp.audit.jsonl';
  // The extension's reconnect alarm is ~30s; wait past it before failing closed.
  const connectMs = Number(process.env.AIB_CONNECT_MS ?? 35_000);

  const ws = new BridgeWsServer({});
  await ws.listen();
  console.error(`[ai-in-browser] bridge WS on ws://127.0.0.1:${ws.port}; audit -> ${auditPath}`);

  const session = new BridgeSession(ws, new JsonlAuditSink(auditPath), 'mcp', connectMs);
  const server = buildServer(session);
  await server.connect(new StdioServerTransport());
  console.error('[ai-in-browser] MCP server ready on stdio.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
