import { describe, it, expect, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { BridgeWsServer, WsExtensionConnection } from '../src/ws-connection.js';
import { Bridge } from '../src/bridge.js';
import { InMemoryAuditSink } from '../src/audit.js';
import {
  BridgeRequestSchema, type BridgeRequest, type Observation,
} from '@ai-in-browser/protocol';

const observation = (over: Partial<Observation> = {}): Observation => ({
  observationId: 'o1', url: 'https://example.com', title: 'T',
  capturedAt: '2026-06-12T00:00:00.000Z',
  elements: [
    { ref: 'link', role: 'link', name: 'Pricing', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'submit', role: 'button', name: 'Submit Application', bounds: { x: 0, y: 0, w: 1, h: 1 } },
    { ref: 'pw', role: 'textbox', name: 'Password', bounds: { x: 0, y: 0, w: 1, h: 1 }, fieldHints: { inputType: 'password' } },
  ],
  textDigest: '', captchaPresent: false, ...over,
});

/** Wire-level FakeExtension: a real WS client answering per script. */
class WirePeer {
  nextObservation: Observation = observation();
  approval: 'approved' | 'denied' | 'timeout' = 'approved';
  handoff: 'continued' | 'took_over' | 'timeout' = 'continued';
  execStatus: 'executed' | 'stale_ref' | 'error' | 'no_match' = 'executed';
  availableOptions: string[] | undefined = undefined;
  silent = false;                 // swallow requests (timeout tests)
  readonly received: BridgeRequest[] = [];
  private constructor(readonly ws: WebSocket) {}

  static connect(port: number): Promise<WirePeer> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const peer = new WirePeer(ws);
    ws.on('message', (data) => {
      const msg = BridgeRequestSchema.parse(JSON.parse(String(data)));
      peer.received.push(msg);
      if (peer.silent || msg.type === 'pong') return;
      if (msg.type === 'observe') {
        ws.send(JSON.stringify({ id: msg.id, type: 'observation', observation: peer.nextObservation }));
      } else if (msg.type === 'execute') {
        ws.send(JSON.stringify({
          id: msg.id, type: 'executed', status: peer.execStatus,
          ...(peer.execStatus === 'executed' ? { observation: peer.nextObservation } : {}),
          ...(peer.execStatus === 'error' ? { error: 'boom' } : {}),
          ...(peer.execStatus === 'no_match' && peer.availableOptions ? { availableOptions: peer.availableOptions } : {}),
        }));
      } else if (msg.type === 'requestApproval') {
        ws.send(JSON.stringify({ id: msg.id, type: 'approval', outcome: peer.approval }));
      } else if (msg.type === 'requestHandoff') {
        ws.send(JSON.stringify({ id: msg.id, type: 'handoff', outcome: peer.handoff }));
      }
    });
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(peer));
      ws.on('error', reject);
    });
  }

  sendRaw(payload: unknown): void { this.ws.send(JSON.stringify(payload)); }
  close(): void { this.ws.close(); }
}

const servers: BridgeWsServer[] = [];
const peers: WirePeer[] = [];
const bareServers: WebSocketServer[] = [];
afterEach(async () => {
  peers.splice(0).forEach((p) => p.close());
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(bareServers.splice(0).map((wss) => new Promise<void>((r) => wss.close(() => r()))));
});

async function connected(timeouts = {}) {
  const server = new BridgeWsServer({ port: 0, timeouts });
  servers.push(server);
  await server.listen();
  const peerP = WirePeer.connect(server.port);
  const conn = await server.waitForConnection();
  const peer = await peerP;
  peers.push(peer);
  return { server, conn, peer };
}

describe('round-trips (the FakeExtension battery over the real wire)', () => {
  it('observe returns the peer observation', async () => {
    const { conn } = await connected();
    expect((await conn.observe()).observationId).toBe('o1');
  });

  it('execute returns the exec outcome with post-observation', async () => {
    const { conn } = await connected();
    const out = await conn.execute({ kind: 'click', ref: 'link', observationId: 'o1' });
    expect(out.status).toBe('executed');
    expect(out.observation?.observationId).toBe('o1');
  });

  it('execute surfaces stale_ref and error outcomes', async () => {
    const { conn, peer } = await connected();
    peer.execStatus = 'stale_ref';
    expect((await conn.execute({ kind: 'click', ref: 'x', observationId: 'o1' })).status).toBe('stale_ref');
    peer.execStatus = 'error';
    const e = await conn.execute({ kind: 'click', ref: 'x', observationId: 'o1' });
    expect(e.status).toBe('error');
    expect(e.error).toBe('boom');
  });

  it('approval relays approved/denied/timeout outcomes', async () => {
    const { conn, peer } = await connected();
    const req = {
      action: { kind: 'click', ref: 'submit', observationId: 'o1' } as const,
      decision: { risk: 'high' as const, requiresApproval: true, blocked: false, reason: 'r' },
    };
    expect(await conn.requestApproval(req)).toBe('approved');
    peer.approval = 'denied';
    expect(await conn.requestApproval(req)).toBe('denied');
  });

  it('handoff relays the outcome', async () => {
    const { conn, peer } = await connected();
    peer.handoff = 'took_over';
    expect(await conn.requestHandoff('yours')).toBe('took_over');
  });
});

describe('fail-closed behavior', () => {
  it('approval timeout -> timeout (silence is never consent)', async () => {
    const { conn, peer } = await connected({ approvalMs: 50 });
    peer.silent = true;
    const outcome = await conn.requestApproval({
      action: { kind: 'click', ref: 'submit', observationId: 'o1' },
      decision: { risk: 'high', requiresApproval: true, blocked: false, reason: 'r' },
    });
    expect(outcome).toBe('timeout');
  });

  it('observe timeout -> rejects', async () => {
    const { conn, peer } = await connected({ observeMs: 50 });
    peer.silent = true;
    await expect(conn.observe()).rejects.toThrow(/timed out/);
  });

  it('execute timeout -> error outcome (unknowable state; AI must re-observe)', async () => {
    const { conn, peer } = await connected({ executeMs: 50 });
    peer.silent = true;
    const out = await conn.execute({ kind: 'click', ref: 'link', observationId: 'o1' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/timed out/);
  });

  it('extension error message fails the pending call', async () => {
    const { conn, peer } = await connected();
    peer.silent = true;
    const p = conn.observe();
    // answer manually with a wire error for the request the peer swallowed
    await new Promise((r) => setTimeout(r, 20));
    const last = peer.received[peer.received.length - 1];
    peer.sendRaw({ id: last.id, type: 'error', message: 'no active tab' });
    await expect(p).rejects.toThrow(/no active tab/);
  });

  it('malformed payload for a pending id fails that call (never mis-parses)', async () => {
    const { conn, peer } = await connected();
    peer.silent = true;
    const p = conn.observe();
    await new Promise((r) => setTimeout(r, 20));
    const last = peer.received[peer.received.length - 1];
    peer.sendRaw({ id: last.id, type: 'observation', observation: { nope: true } });
    await expect(p).rejects.toThrow();
  });

  it('disconnect mid-approval -> timeout outcome (never consent)', async () => {
    const { conn, peer } = await connected();
    peer.silent = true;
    const approvalP = conn.requestApproval({
      action: { kind: 'click', ref: 'submit', observationId: 'o1' },
      decision: { risk: 'high', requiresApproval: true, blocked: false, reason: 'r' },
    });
    await new Promise((r) => setTimeout(r, 20));
    peer.close();
    expect(await approvalP).toBe('timeout');
  });

  it('handoff timeout -> timeout (silence is never consent)', async () => {
    const { conn, peer } = await connected({ handoffMs: 50 });
    peer.silent = true;
    expect(await conn.requestHandoff('yours')).toBe('timeout');
  });

  it('socket close drains ALL pending calls (not just one)', async () => {
    const { conn, peer } = await connected();
    peer.silent = true;
    const observeP = conn.observe();
    const approvalP = conn.requestApproval({
      action: { kind: 'click', ref: 'submit', observationId: 'o1' },
      decision: { risk: 'high', requiresApproval: true, blocked: false, reason: 'r' },
    });
    await new Promise((r) => setTimeout(r, 20));
    peer.close();
    await expect(observeP).rejects.toThrow();
    expect(await approvalP).toBe('timeout');
  });

  it('a second connection is refused while one is active', async () => {
    const { server } = await connected();
    const second = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const closed = await new Promise<number>((resolve) => second.on('close', resolve));
    expect(closed).toBe(1013); // "try again later"
  });

  it('a socket error fails pending calls closed instead of crashing', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    bareServers.push(wss);
    await new Promise<void>((r) => wss.on('listening', r));
    const { port } = wss.address() as AddressInfo;
    const serverSocketP = new Promise<WebSocket>((r) => wss.on('connection', (s) => r(s)));
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => client.on('open', r));
    const serverSocket = await serverSocketP;
    const conn = new WsExtensionConnection(serverSocket);
    const observeP = conn.observe();
    serverSocket.emit('error', new Error('boom'));
    await expect(observeP).rejects.toThrow();
    client.close();
  });

  it('a new extension is accepted after the previous one disconnects', async () => {
    const { server, peer } = await connected();
    // Close the first peer and wait for the server-side connection to drain
    peer.close();
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('server connection did not clear')), 2000);
      const check = () => {
        if (server.connection === null) { clearTimeout(deadline); resolve(); return; }
        setTimeout(check, 10);
      };
      setTimeout(check, 10);
    });
    // Now connect a second peer — should be accepted, not refused with 1013
    const peer2 = await WirePeer.connect(server.port);
    peers.push(peer2);
    const conn2 = await server.waitForConnection();
    expect((await conn2.observe()).observationId).toBe('o1');
  });

  it('answers extension pings with pongs', async () => {
    const { peer } = await connected();
    const pong = new Promise<unknown>((resolve) => {
      peer.ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.type === 'pong') resolve(m);
      });
    });
    peer.sendRaw({ id: 'p1', type: 'ping' });
    expect(await pong).toMatchObject({ id: 'p1', type: 'pong' });
  });
});

describe('Bridge over the real wire (conformance with the Plan-2 battery)', () => {
  async function wiredBridge() {
    const ctx = await connected();
    const audit = new InMemoryAuditSink();
    const bridge = new Bridge({ connection: ctx.conn, audit, now: () => 't', newActionId: () => 'aid' });
    await bridge.observe();
    return { ...ctx, audit, bridge };
  }

  it('ordinary click auto-executes, no approval request crosses the wire', async () => {
    const { bridge, peer } = await wiredBridge();
    const r = await bridge.act({ kind: 'click', ref: 'link', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('executed');
    expect(peer.received.some((m) => m.type === 'requestApproval')).toBe(false);
  });

  it('submit click gates: denied never executes', async () => {
    const { bridge, peer, audit } = await wiredBridge();
    peer.approval = 'denied';
    const r = await bridge.act({ kind: 'click', ref: 'submit', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('denied');
    expect(peer.received.some((m) => m.type === 'execute')).toBe(false);
    expect(audit.records).toHaveLength(1);
  });

  it('sensitive type value crosses the wire to execute but is redacted in audit', async () => {
    const { bridge, peer, audit } = await wiredBridge();
    peer.approval = 'approved';
    await bridge.act({ kind: 'type', ref: 'pw', value: 'hunter2', observationId: 'o1' }, 'mcp');
    const json = JSON.stringify(audit.records);
    expect(json).not.toContain('hunter2');
    expect(json).toContain('[redacted]');
  });

  it('execute no_match round-trips availableOptions over the WebSocket', async () => {
    const { peer, bridge } = await wiredBridge();
    peer.execStatus = 'no_match';
    peer.availableOptions = ['United States', 'Canada'];
    const r = await bridge.act({ kind: 'select', ref: 'link', option: 'USA', observationId: 'o1' }, 'mcp');
    expect(r.status).toBe('no_match');
    expect(r.availableOptions).toEqual(['United States', 'Canada']);
  });
});
