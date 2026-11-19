import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  BridgeRequestSchema, ExtensionMessageSchema, WS_DEFAULT_HOST, WS_DEFAULT_PORT,
  type BridgeRequest, type ExtensionMessage, type Observation, type BrowserAction,
} from '@ai-in-browser/protocol';
import type {
  ExtensionConnection, ExecOutcome, ApprovalRequest, ApprovalOutcome, HandoffOutcome,
} from './connection.js';

export interface WsTimeouts {
  observeMs?: number;   // default 15_000
  executeMs?: number;   // default 20_000
  approvalMs?: number;  // default 120_000 — the human gate
  handoffMs?: number;   // default 600_000 — "your turn" can take a while
}

const DEFAULTS: Required<WsTimeouts> = {
  observeMs: 15_000, executeMs: 20_000, approvalMs: 120_000, handoffMs: 600_000,
};

type Pending = {
  resolve: (msg: ExtensionMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

// Omit<Union, K> collapses a discriminated union to its common keys; this keeps
// each variant intact so request bodies like { type: 'execute', action } typecheck.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** ExtensionConnection over one WebSocket: id-correlated, per-call timeouts, fail-closed. */
export class WsExtensionConnection implements ExtensionConnection {
  private readonly pending = new Map<string, Pending>();
  private readonly timeouts: Required<WsTimeouts>;
  private idCounter = 0;

  constructor(private readonly socket: WebSocket, timeouts: WsTimeouts = {}) {
    this.timeouts = { ...DEFAULTS, ...timeouts };
    socket.on('message', (data) => this.onMessage(data));
    socket.on('close', () => this.failAll('extension disconnected'));
    socket.on('error', () => this.failAll('extension socket error'));
  }

  get isOpen(): boolean { return this.socket.readyState === WebSocket.OPEN; }

  async observe(): Promise<Observation> {
    const msg = await this.request({ type: 'observe' }, this.timeouts.observeMs);
    if (msg.type !== 'observation') throw new Error(`expected observation, got ${msg.type}`);
    return msg.observation;
  }

  async execute(action: BrowserAction): Promise<ExecOutcome> {
    try {
      const msg = await this.request({ type: 'execute', action }, this.timeouts.executeMs);
      if (msg.type !== 'executed') return { status: 'error', error: `expected executed, got ${msg.type}` };
      return { status: msg.status, observation: msg.observation, error: msg.error, availableOptions: msg.availableOptions };
    } catch (err) {
      // Timeout/disconnect mid-execute: the action's fate is unknowable — fail closed,
      // the AI must re-observe before acting again.
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalOutcome> {
    try {
      const msg = await this.request(
        { type: 'requestApproval', action: req.action, decision: req.decision, target: req.target },
        this.timeouts.approvalMs,
      );
      if (msg.type !== 'approval') return 'timeout';
      return msg.outcome;
    } catch {
      return 'timeout'; // silence/disconnect is never consent
    }
  }

  async requestHandoff(reason: string): Promise<HandoffOutcome> {
    try {
      const msg = await this.request({ type: 'requestHandoff', reason }, this.timeouts.handoffMs);
      if (msg.type !== 'handoff') return 'timeout';
      return msg.outcome;
    } catch {
      return 'timeout';
    }
  }

  private request(body: DistributiveOmit<BridgeRequest, 'id'>, timeoutMs: number): Promise<ExtensionMessage> {
    const id = `r${++this.idCounter}`;
    const req = BridgeRequestSchema.parse({ ...body, id }); // validate our own output too
    return new Promise<ExtensionMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${body.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(req));
    });
  }

  private onMessage(data: unknown): void {
    let msg: ExtensionMessage;
    try {
      msg = ExtensionMessageSchema.parse(JSON.parse(String(data)));
    } catch {
      // Malformed frame. If it carries an id we have pending, fail that call (never
      // mis-parse into a success); otherwise drop it.
      const id = this.peekId(data);
      if (id) this.fail(id, 'malformed message from extension');
      return;
    }
    if (msg.type === 'ping') {
      this.socket.send(JSON.stringify({ id: msg.id, type: 'pong' }));
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return; // late/unknown reply — already timed out
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  private peekId(data: unknown): string | null {
    try {
      const raw = JSON.parse(String(data)) as { id?: unknown };
      return typeof raw.id === 'string' ? raw.id : null;
    } catch {
      return null;
    }
  }

  private fail(id: string, reason: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }

  private failAll(reason: string): void {
    for (const id of [...this.pending.keys()]) this.fail(id, reason);
  }
}

export interface BridgeWsServerOptions {
  port?: number;        // 0 = ephemeral (tests); default 8765
  host?: string;        // default 127.0.0.1 — never expose beyond localhost
  timeouts?: WsTimeouts;
}

/** Owns the WS server and the SINGLE extension connection (slice 1 serializes). */
export class BridgeWsServer {
  private wss: WebSocketServer | null = null;
  private current: WsExtensionConnection | null = null;
  private waiters: Array<(c: WsExtensionConnection) => void> = [];
  private readonly opts: BridgeWsServerOptions;

  constructor(opts: BridgeWsServerOptions = {}) { this.opts = opts; }

  get port(): number {
    const addr = this.wss?.address() as AddressInfo | null;
    if (!addr || typeof addr === 'string') throw new Error('server not listening');
    return addr.port;
  }

  get connection(): WsExtensionConnection | null {
    return this.current?.isOpen ? this.current : null;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? WS_DEFAULT_HOST,
        port: this.opts.port ?? WS_DEFAULT_PORT,
      });
      this.wss = wss;
      wss.on('connection', (socket) => {
        if (this.connection) {
          socket.on('error', () => {});
          socket.close(1013, 'an extension is already connected');
          return;
        }
        this.current = new WsExtensionConnection(socket, this.opts.timeouts);
        this.waiters.splice(0).forEach((w) => w(this.current!));
      });
      wss.on('listening', resolve);
      wss.on('error', reject);
    });
  }

  /** Resolves with the active connection (immediately if one exists). */
  waitForConnection(): Promise<WsExtensionConnection> {
    const live = this.connection;
    if (live) return Promise.resolve(live);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const wss = this.wss;
      if (!wss) return resolve();
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    });
  }
}
