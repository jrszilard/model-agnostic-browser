import { Bridge } from '@ai-in-browser/bridge-server';
import type { AuditSink, ExtensionConnection } from '@ai-in-browser/bridge-server';

/** An ExtensionConnection that reports whether its socket is still open. */
export type LiveConnection = ExtensionConnection & { readonly isOpen: boolean };

/**
 * The slice of BridgeWsServer the session needs (keeps the session unit-testable).
 * Contract: `waitForConnection()` MUST resolve-or-stay-pending, never reject — the
 * connect-timeout in `connectOrTimeout` relies on this (it leaves the promise
 * un-`.catch`'d). The real `BridgeWsServer` honors it (resolve-only).
 */
export interface ConnectionSource {
  readonly connection: LiveConnection | null;
  waitForConnection(): Promise<LiveConnection>;
}

/**
 * Binds ONE long-lived Bridge to the current extension connection so stale-ref
 * state persists across tool calls. Re-binds transparently after a reconnect
 * (the AI naturally re-observes). Fails closed with a diagnostic if no extension
 * connects within `connectMs` (default 10s) instead of hanging forever.
 */
export class BridgeSession {
  private bound: { bridge: Bridge; conn: LiveConnection } | null = null;

  constructor(
    private readonly src: ConnectionSource,
    private readonly audit: AuditSink,
    readonly clientId: string,
    private readonly connectMs = 10_000,
  ) {}

  async getBridge(): Promise<Bridge> {
    if (this.bound && this.bound.conn.isOpen) return this.bound.bridge;
    const conn = await this.connectOrTimeout();
    const bridge = new Bridge({ connection: conn, audit: this.audit });
    this.bound = { bridge, conn };
    return bridge;
  }

  private connectOrTimeout(): Promise<LiveConnection> {
    const live = this.src.connection;
    if (live) return Promise.resolve(live);
    return new Promise<LiveConnection>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no browser connected — is the ai-in-browser extension running in Brave?')),
        this.connectMs,
      );
      this.src.waitForConnection().then((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }
}
