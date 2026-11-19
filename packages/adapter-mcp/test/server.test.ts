import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeExtension, InMemoryAuditSink } from '@ai-in-browser/bridge-server';
import type { Observation } from '@ai-in-browser/protocol';
import { BridgeSession, type ConnectionSource, type LiveConnection } from '../src/session.js';
import { buildServer } from '../src/server.js';

class FakeConn extends FakeExtension {
  isOpen = true;
}

const obs = (): Observation => ({
  observationId: 'o1',
  url: 'http://127.0.0.1/form',
  title: 'Form',
  capturedAt: '2026-06-15T00:00:00.000Z',
  elements: [{ ref: 'e1', role: 'textbox', name: 'Full name', bounds: { x: 0, y: 0, w: 1, h: 1 } }],
  textDigest: 'a form',
  captchaPresent: false,
});

async function connectedClient() {
  const fake = new FakeConn();
  fake.nextObservation = obs();
  fake.exec = { status: 'executed', observation: obs() };
  const src: ConnectionSource = {
    get connection(): LiveConnection | null {
      return fake;
    },
    waitForConnection: async () => fake,
  };
  const session = new BridgeSession(src, new InMemoryAuditSink(), 'mcp');
  const server = buildServer(session);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientT);
  return { client, fake };
}

describe('buildServer over an in-memory MCP transport', () => {
  it('registers exactly the six browser_* tools', async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'browser_await_human',
      'browser_click',
      'browser_navigate',
      'browser_observe',
      'browser_select',
      'browser_type',
    ]);
    await client.close();
  });

  it('browser_observe returns the formatted observation through the wire', async () => {
    const { client } = await connectedClient();
    const res = (await client.callTool({ name: 'browser_observe', arguments: {} })) as {
      content: { text: string }[];
    };
    expect(res.content[0].text).toContain('"observationId": "o1"');
    await client.close();
  });

  it('browser_navigate validates its input schema and drives the bridge', async () => {
    const { client, fake } = await connectedClient();
    const res = (await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'http://127.0.0.1/form' },
    })) as { content: { text: string }[] };
    expect(fake.executed.at(-1)).toEqual({ kind: 'navigate', url: 'http://127.0.0.1/form' });
    expect(res.content[0].text).toContain('status: executed');
    await client.close();
  });
});
