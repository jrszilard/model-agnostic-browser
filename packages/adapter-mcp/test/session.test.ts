import { describe, it, expect } from 'vitest';
import { Bridge, FakeExtension, InMemoryAuditSink } from '@ai-in-browser/bridge-server';
import { BridgeSession, type ConnectionSource, type LiveConnection } from '../src/session.js';

// FakeExtension implements ExtensionConnection; add isOpen to satisfy LiveConnection.
class FakeConn extends FakeExtension {
  isOpen = true;
}

function source(conn: FakeConn | null, opts: { neverConnects?: boolean } = {}): ConnectionSource {
  return {
    get connection(): LiveConnection | null {
      return conn;
    },
    waitForConnection(): Promise<LiveConnection> {
      if (opts.neverConnects) return new Promise<LiveConnection>(() => {}); // hangs forever
      return Promise.resolve(conn as LiveConnection);
    },
  };
}

describe('BridgeSession.getBridge', () => {
  it('returns a Bridge bound to the live connection and reuses it across calls', async () => {
    const conn = new FakeConn();
    const session = new BridgeSession(source(conn), new InMemoryAuditSink(), 'mcp');
    const a = await session.getBridge();
    const b = await session.getBridge();
    expect(a).toBeInstanceOf(Bridge);
    expect(b).toBe(a); // same instance -> stale-ref state persists across tool calls
  });

  it('rebinds to a fresh Bridge when the previous connection has closed', async () => {
    const conn = new FakeConn();
    const session = new BridgeSession(source(conn), new InMemoryAuditSink(), 'mcp');
    const first = await session.getBridge();
    conn.isOpen = false; // socket dropped
    const second = await session.getBridge();
    expect(second).not.toBe(first);
  });

  it('fails closed with a diagnostic when no extension connects in time', async () => {
    const session = new BridgeSession(source(null, { neverConnects: true }), new InMemoryAuditSink(), 'mcp', 20);
    await expect(session.getBridge()).rejects.toThrow(/no browser connected/i);
  });
});
