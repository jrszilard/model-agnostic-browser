# model-agnostic-browser

Let an MCP client observe and interact with a tab in Brave or Chrome. A browser extension connects to a local WebSocket bridge. The bridge evaluates proposed actions and asks for approval in the tab when its rules flag a sensitive field or risky click. No hosted browser, model API key, or cloud broker is required by the bridge.

## Try it on a local form

Use Node.js 22 with Corepack and an isolated browser profile for the demo. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @ai-in-browser/extension build
```

1. Open your browser's Extensions page in the demo profile. Enable **Developer mode**, choose **Load unpacked**, and select `packages/extension/dist/`.
2. Run `corepack pnpm exec tsx examples/mcp-client/src/demo.ts`. It starts the bridge on `127.0.0.1:8765` and serves a form populated with fictional data. If the extension hasn't connected yet, reload it from the Extensions page.
3. Follow the prompts in the tab: approve typing the **demo** password, **deny** the submit click, and continue the handoff. See the [demo guide](examples/mcp-client/README.md) for details.

## Connect your MCP client

Configure the client to launch `corepack pnpm exec tsx packages/adapter-mcp/src/main.ts` over stdio, with the repository root as its working directory. Run only one adapter or demo at a time. The adapter exposes six tools:

| Tool | Purpose |
| --- | --- |
| `browser_observe` | Read the current page and get element references. |
| `browser_navigate` | Navigate the active tab to a URL. |
| `browser_click` | Click a referenced element. |
| `browser_type` | Enter text in a referenced field. |
| `browser_select` | Choose an option in a dropdown. |
| `browser_await_human` | Pause and hand control back to the user. |

## Privacy and limits

- The extension can read and act on HTTP(S) pages in the enabled profile. Use it only on pages you intend to share with your client. If the client uses a hosted model, data it receives may leave your machine.
- Approval rules are a safeguard, not a sandbox. Keep the bridge on loopback, use trusted clients, and review important actions yourself. The project does not solve CAPTCHAs or bypass anti-bot checks.
- The adapter writes a local `*.audit.jsonl` log. Recognized sensitive field values are redacted, but URLs and ordinary form values can still identify people. Do **not** share logs or demo terminal output from real sessions.

## Development

```sh
corepack pnpm typecheck
corepack pnpm test
```

`packages/protocol` defines the wire format and policy; `packages/bridge-server` handles connections, approvals, and audit records; `packages/extension` interacts with the page; and `packages/adapter-mcp` exposes the tools. Internal workspace packages use the `@ai-in-browser` scope.
