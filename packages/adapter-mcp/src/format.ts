import type { Observation, ActionResult, HandoffEvent } from '@ai-in-browser/protocol';

/** Lean JSON the AI can act on: refs + roles + names + any <select> options. */
export function formatObservation(o: Observation): string {
  const elements = o.elements.map((e) => ({
    ref: e.ref,
    role: e.role,
    name: e.name,
    ...(e.widget ? { widget: e.widget } : {}),
    ...(e.value ? { value: e.value } : {}),
    ...(e.options ? { options: e.options } : {}),
    ...(e.required ? { required: true } : {}),
  }));
  return JSON.stringify(
    {
      observationId: o.observationId,
      url: o.url,
      title: o.title,
      captchaPresent: o.captchaPresent,
      elements,
      textDigest: o.textDigest,
    },
    null,
    2,
  );
}

/** Readable summary of an action outcome + the post-action page (when executed). */
export function formatResult(r: ActionResult): string {
  const lines = [`status: ${r.status}`, `risk: ${r.decision.risk}`, `reason: ${r.decision.reason}`];
  if (r.approvedBy) lines.push(`approvedBy: ${r.approvedBy}`);
  if (r.error) lines.push(`error: ${r.error}`);
  if (r.availableOptions) lines.push(`availableOptions: ${r.availableOptions.join(', ')}`);
  let text = lines.join('\n');
  if (r.observation) text += `\n\n--- page after action ---\n${formatObservation(r.observation)}`;
  return text;
}

/** One-line handoff summary (outcome + reason) for the await_human tool result. */
export function formatHandoff(h: HandoffEvent): string {
  return `handoff outcome: ${h.outcome}\nreason: ${h.reason}`;
}
