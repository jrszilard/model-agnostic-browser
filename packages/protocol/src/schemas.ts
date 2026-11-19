import { z } from 'zod';
export const ElementRefSchema = z.object({
  ref: z.string(), role: z.string(), name: z.string(),
  bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  fieldHints: z.object({ inputType: z.string().optional(), autocomplete: z.string().optional(), name: z.string().optional() }).optional(),
  options: z.array(z.string()).optional(),
  widget: z.enum(['native_select', 'combobox', 'typeahead']).optional(),
  value: z.string().optional(),
  required: z.boolean().optional(),
});
export const ObservationSchema = z.object({
  observationId: z.string(), url: z.string(), title: z.string(), capturedAt: z.string(),
  elements: z.array(ElementRefSchema), textDigest: z.string(), captchaPresent: z.boolean(),
});
export const BrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string() }),
  z.object({ kind: z.literal('click'), ref: z.string(), observationId: z.string() }),
  z.object({ kind: z.literal('type'), ref: z.string(), value: z.string(), observationId: z.string() }),
  z.object({ kind: z.literal('select'), ref: z.string(), option: z.string(), observationId: z.string() }),
]);
export const PolicyDecisionSchema = z.object({
  risk: z.enum(['low', 'medium', 'high', 'blocked']),
  requiresApproval: z.boolean(),
  blocked: z.boolean(),
  reason: z.string(),
});
