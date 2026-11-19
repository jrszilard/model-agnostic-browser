import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BridgeSession } from './session.js';
import { runObserve, runNavigate, runClick, runType, runSelect, runAwaitHuman, type ToolText } from './tools.js';

// ToolText matches CallToolResult except for the SDK's `[x: string]: unknown`
// index signature (a $loose-schema artefact). A SINGLE assertion bridges that gap
// while still letting tsc verify the content shape; `as unknown as` would erase
// that check and silently hide a future ToolText shape regression.
const r = (t: ToolText): CallToolResult => t as CallToolResult;

const REF = z.string().describe('a ref from the latest browser_observe');
const OBS = z.string().describe('the observationId from the latest browser_observe (staleness guard)');

/** Build the slice-1 MCP server. Tools are thin: each maps to one bridge call. */
export function buildServer(session: BridgeSession): McpServer {
  const server = new McpServer({ name: 'ai-in-browser', version: '0.0.1' });
  const cid = session.clientId;

  server.registerTool(
    'browser_observe',
    { description: 'Observe the live page: returns refs, roles, names, <select> options, and a CAPTCHA flag.', inputSchema: {} },
    async () => r(await runObserve(await session.getBridge())),
  );

  server.registerTool(
    'browser_navigate',
    { description: 'Navigate the active tab to a URL (low risk, auto-executes).', inputSchema: { url: z.string().describe('absolute URL') } },
    async ({ url }) => r(await runNavigate(await session.getBridge(), { url }, cid)),
  );

  server.registerTool(
    'browser_click',
    { description: 'Click an element. Ordinary controls auto-execute; submit/apply/pay/delete-style controls require human approval.', inputSchema: { ref: REF, observationId: OBS } },
    async ({ ref, observationId }) => r(await runClick(await session.getBridge(), { ref, observationId }, cid)),
  );

  server.registerTool(
    'browser_type',
    { description: 'Type into a field. Ordinary fields auto-execute; sensitive fields (password/cc/ssn) require human approval and are redacted in the audit.', inputSchema: { ref: REF, value: z.string(), observationId: OBS } },
    async ({ ref, value, observationId }) => r(await runType(await session.getBridge(), { ref, value, observationId }, cid)),
  );

  server.registerTool(
    'browser_select',
    { description: 'Choose an option in a native <select> (auto-executes). Pick only from the options the observation surfaced.', inputSchema: { ref: REF, option: z.string(), observationId: OBS } },
    async ({ ref, option, observationId }) => r(await runSelect(await session.getBridge(), { ref, option, observationId }, cid)),
  );

  server.registerTool(
    'browser_await_human',
    { description: 'Proactively hand off to the human for review/input (e.g. "this field is yours", "review the filled form"). Renders the approval overlay and waits.', inputSchema: { reason: z.string() } },
    async ({ reason }) => r(await runAwaitHuman(await session.getBridge(), { reason }, cid)),
  );

  return server;
}
