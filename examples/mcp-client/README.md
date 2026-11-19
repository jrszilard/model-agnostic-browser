# model-agnostic-browser — MCP client demo

Uses the MCP adapter and a local fixture to demonstrate observation, form filling, approval, denial, and handoff in a Brave demo profile.

## Prerequisites
1. Build the extension and load `packages/extension/dist/` unpacked in Brave (Developer mode).
2. Make sure nothing else is bound to `ws://127.0.0.1:8765` (no other bridge/adapter running).

## Run
```bash
corepack pnpm exec tsx examples/mcp-client/src/demo.ts
```
The demo serves the test form on `127.0.0.1:8799`, spawns the adapter (which starts the
bridge WS server), and waits for the extension to connect (~within its 30s reconnect alarm;
reload the extension to connect immediately).

Then, in Brave:
- **Approve** the password overlay (blue button).
- **Deny** the Submit overlay (gray button) — proves never-auto-submit.
- **Continue** the handoff overlay.

The demo prints each tool result and confirms the audit (`adapter-mcp-demo.audit.jsonl`,
gitignored) redacted the password. `*.audit.jsonl` is already covered by `.gitignore`.

## Using it from Claude Code / Cursor instead
Point your MCP client at the adapter command:
`corepack pnpm exec tsx packages/adapter-mcp/src/main.ts` (cwd = repo root), then ask it to
"open this form and fill it but don't submit."
