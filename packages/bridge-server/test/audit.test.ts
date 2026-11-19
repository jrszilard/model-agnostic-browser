import { describe, it, expect } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAuditSink, JsonlAuditSink } from '../src/audit.js';
import type { HandoffEvent } from '@ai-in-browser/protocol';

const rec = (reason: string): HandoffEvent => ({
  ts: 't', clientId: 'c', url: 'u', reason, outcome: 'continued',
});

describe('InMemoryAuditSink', () => {
  it('collects records in order', async () => {
    const sink = new InMemoryAuditSink();
    await sink.append(rec('a'));
    await sink.append(rec('b'));
    expect(sink.records.map((r) => (r as HandoffEvent).reason)).toEqual(['a', 'b']);
  });
});

describe('JsonlAuditSink', () => {
  it('appends one JSON line per record', async () => {
    const path = join(tmpdir(), `ai-in-browser-audit-${process.pid}.jsonl`);
    await rm(path, { force: true });
    const sink = new JsonlAuditSink(path);
    await sink.append(rec('one'));
    await sink.append(rec('two'));
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).reason).toBe('one');
    expect(JSON.parse(lines[1]).reason).toBe('two');
    await rm(path, { force: true });
  });
});
