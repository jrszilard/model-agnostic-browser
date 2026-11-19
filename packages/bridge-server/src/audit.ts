import { appendFile } from 'node:fs/promises';
import type { AuditEvent, HandoffEvent } from '@ai-in-browser/protocol';

export type AuditRecord = AuditEvent | HandoffEvent;

export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}

/** Test/inspection sink — keeps records in memory. */
export class InMemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];
  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

/** Real sink — one JSON line per record, appended to a per-user file. */
export class JsonlAuditSink implements AuditSink {
  constructor(private readonly path: string) {}
  async append(record: AuditRecord): Promise<void> {
    await appendFile(this.path, JSON.stringify(record) + '\n', 'utf8');
  }
}
