import { z } from 'zod';
import {
  ObservationSchema, BrowserActionSchema, ElementRefSchema, PolicyDecisionSchema,
} from './schemas.js';

export const WS_DEFAULT_PORT = 8765;
export const WS_DEFAULT_HOST = '127.0.0.1';

/**
 * Bridge -> extension. Every request carries an id; the extension answers with a
 * message bearing the SAME id. `pong` answers the extension's keepalive `ping`
 * (which also keeps the MV3 service worker alive — Chromium >=116 extends the
 * worker's lifetime on WebSocket activity).
 */
// Unknown-key posture (untrusted boundary): zod strips unknown keys by default,
// and both the bridge and the extension forward the PARSED output (never the raw
// frame) downstream — so any smuggled field is dropped, not propagated. We
// deliberately do NOT use `.strict()`: a forward-compatible field added by a peer
// must not hard-fail an in-flight call. The pin tests below lock this in so any
// future switch to strict/passthrough is a conscious change.
export const BridgeRequestSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('observe') }),
  z.object({ id: z.string(), type: z.literal('execute'), action: BrowserActionSchema }),
  z.object({
    id: z.string(), type: z.literal('requestApproval'),
    action: BrowserActionSchema, decision: PolicyDecisionSchema,
    target: ElementRefSchema.optional(),
  }),
  z.object({ id: z.string(), type: z.literal('requestHandoff'), reason: z.string() }),
  z.object({ id: z.string(), type: z.literal('pong') }),
]);
export type BridgeRequest = z.infer<typeof BridgeRequestSchema>;

/** Extension -> bridge. `error` fails the pending call with that id (fail closed). */
export const ExtensionMessageSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('observation'), observation: ObservationSchema }),
  z.object({
    id: z.string(), type: z.literal('executed'),
    status: z.enum(['executed', 'stale_ref', 'error', 'no_match']),
    observation: ObservationSchema.optional(), error: z.string().optional(),
    availableOptions: z.array(z.string()).optional(),
  }),
  z.object({ id: z.string(), type: z.literal('approval'), outcome: z.enum(['approved', 'denied', 'timeout']) }),
  z.object({ id: z.string(), type: z.literal('handoff'), outcome: z.enum(['continued', 'took_over', 'timeout']) }),
  z.object({ id: z.string(), type: z.literal('error'), message: z.string() }),
  z.object({ id: z.string(), type: z.literal('ping') }),
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;
