import type { Bridge } from '@ai-in-browser/bridge-server';
import { formatObservation, formatResult, formatHandoff } from './format.js';

export interface ToolText {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const text = (t: string, isError = false): ToolText => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

// `error` is a genuine failure the AI must react to; denied/blocked/stale_ref are
// valid policy/loop outcomes, returned as normal content (not tool errors).
const isFailure = (status: string): boolean => status === 'error';

export async function runObserve(bridge: Bridge): Promise<ToolText> {
  return text(formatObservation(await bridge.observe()));
}

export async function runNavigate(bridge: Bridge, args: { url: string }, clientId: string): Promise<ToolText> {
  const r = await bridge.act({ kind: 'navigate', url: args.url }, clientId);
  return text(formatResult(r), isFailure(r.status));
}

export async function runClick(bridge: Bridge, args: { ref: string; observationId: string }, clientId: string): Promise<ToolText> {
  const r = await bridge.act({ kind: 'click', ref: args.ref, observationId: args.observationId }, clientId);
  return text(formatResult(r), isFailure(r.status));
}

export async function runType(bridge: Bridge, args: { ref: string; value: string; observationId: string }, clientId: string): Promise<ToolText> {
  const r = await bridge.act({ kind: 'type', ref: args.ref, value: args.value, observationId: args.observationId }, clientId);
  return text(formatResult(r), isFailure(r.status));
}

export async function runSelect(bridge: Bridge, args: { ref: string; option: string; observationId: string }, clientId: string): Promise<ToolText> {
  const r = await bridge.act({ kind: 'select', ref: args.ref, option: args.option, observationId: args.observationId }, clientId);
  return text(formatResult(r), isFailure(r.status));
}

export async function runAwaitHuman(bridge: Bridge, args: { reason: string }, clientId: string): Promise<ToolText> {
  return text(formatHandoff(await bridge.awaitHuman(args.reason, clientId)));
}
