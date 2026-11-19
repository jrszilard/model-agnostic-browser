import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('@modelcontextprotocol/sdk import surface (slice-1 pin)', () => {
  it('exposes the server/client/transport classes the adapter relies on', () => {
    expect(typeof McpServer).toBe('function');
    expect(typeof StdioServerTransport).toBe('function');
    expect(typeof Client).toBe('function');
    expect(typeof StdioClientTransport).toBe('function');
    expect(typeof InMemoryTransport.createLinkedPair).toBe('function');
  });

  it('constructs an McpServer and a linked transport pair', () => {
    const server = new McpServer({ name: 'smoke', version: '0.0.0' });
    expect(server).toBeTruthy();
    const [a, b] = InMemoryTransport.createLinkedPair();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });
});
