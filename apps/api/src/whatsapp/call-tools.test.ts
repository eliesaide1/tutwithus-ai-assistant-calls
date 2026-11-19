import { describe, expect, it, vi } from 'vitest';
import type { ToolCall, ToolExecution } from '../core/tools/tool-gateway.js';
import { buildLiveKitTools } from './call-tools.js';

const call: ToolCall = {
  context: {
    sessionId: 'session-1',
    locale: 'en',
    retrieval: { topK: 5, minScore: 0.7 },
    responseExpectation: 'Soon.',
  },
  callCounts: new Map(),
  recordExpiresAt: new Date('2026-12-05T00:00:00Z'),
  customerVerified: false,
};

const definitions = [
  {
    type: 'function' as const,
    name: 'search_knowledge',
    description: 'Search the approved knowledge.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    type: 'function' as const,
    name: 'end_call',
    description: 'End the call.',
    parameters: { type: 'object', properties: {} },
  },
];

function createGateway(execution: Partial<ToolExecution> = {}) {
  return {
    realtimeTools: vi.fn(() => definitions),
    execute: vi.fn(async (): Promise<ToolExecution> => ({
      output: '{"found":true}',
      citations: [],
      endCall: false,
      ...execution,
    })),
  };
}

// The LiveKit tool's execute takes (args, context); the context is unused here.
async function run(tool: unknown, args: unknown): Promise<unknown> {
  const { execute } = tool as {
    execute: (args: unknown, ctx: unknown) => unknown;
  };
  return execute(args, {});
}

describe('buildLiveKitTools', () => {
  it('forwards result guidance without exposing server-only credentials', async () => {
    const gateway = createGateway({
      followUpInstructions: 'Say the confirmation once.',
      allowToolCalls: true,
      serverAccessToken: 'private-token',
    });
    const tools = buildLiveKitTools({ gateway, call, onEndCall: vi.fn() });
    const output = await run(tools.search_knowledge, { query: 'course' });
    expect(JSON.parse(String(output))).toEqual({
      result: { found: true },
      instruction: 'Say the confirmation once.',
      continueWithTools: true,
    });
    expect(String(output)).not.toContain('private-token');
  });
  it('offers exactly the tools the shared gateway lists', () => {
    const tools = buildLiveKitTools({
      gateway: createGateway(),
      call,
      onEndCall: vi.fn(),
    });

    expect(Object.keys(tools)).toEqual(['search_knowledge', 'end_call']);
  });

  it('sends the model arguments to the shared gateway as JSON', async () => {
    const gateway = createGateway();
    const tools = buildLiveKitTools({ gateway, call, onEndCall: vi.fn() });

    const result = await run(tools.search_knowledge, { query: 'prices' });

    expect(gateway.execute).toHaveBeenCalledWith(
      call,
      'search_knowledge',
      '{"query":"prices"}',
    );
    expect(result).toBe('{"found":true}');
  });

  it('returns a denial from the gateway to the model unchanged', async () => {
    const denied = '{"error":"denied","reason":"ACCOUNT_NOT_VERIFIED"}';
    const gateway = createGateway({ output: denied });
    const tools = buildLiveKitTools({ gateway, call, onEndCall: vi.fn() });

    expect(await run(tools.end_call, {})).toBe(denied);
  });

  it('does not end the call for an ordinary tool result', async () => {
    const onEndCall = vi.fn();
    const tools = buildLiveKitTools({
      gateway: createGateway(),
      call,
      onEndCall,
    });

    await run(tools.search_knowledge, { query: 'hours' });

    expect(onEndCall).not.toHaveBeenCalled();
  });

  it('asks to end the call only when the gateway allowed end_call', async () => {
    const onEndCall = vi.fn();
    const tools = buildLiveKitTools({
      gateway: createGateway({ output: '{"status":"ending"}', endCall: true }),
      call,
      onEndCall,
    });

    await run(tools.end_call, {});

    expect(onEndCall).toHaveBeenCalledTimes(1);
  });

  it('passes an empty object when the model sends no arguments', async () => {
    const gateway = createGateway();
    const tools = buildLiveKitTools({ gateway, call, onEndCall: vi.fn() });

    await run(tools.end_call, undefined);

    expect(gateway.execute).toHaveBeenCalledWith(call, 'end_call', '{}');
  });

  it('refreshes LiveKit tools after the gateway verifies the caller role', async () => {
    const studentTool = {
      type: 'function' as const,
      name: 'student_action',
      description: 'Student-only action.',
      parameters: { type: 'object', properties: {} },
    };
    const accessChanged = vi.fn();
    const verifiedCall: ToolCall = {
      ...call,
      callCounts: new Map(),
      customerVerified: false,
    };
    const gateway = {
      realtimeTools: vi.fn(
        (access: { customerVerified: boolean; serverRole?: string }) =>
          access.customerVerified && access.serverRole === 'student'
            ? [...definitions, studentTool]
            : definitions,
      ),
      execute: vi.fn(async (actualCall: ToolCall): Promise<ToolExecution> => {
        actualCall.customerVerified = true;
        actualCall.serverAccessToken = 'server-only-token';
        actualCall.serverRole = 'student';
        return {
          output: '{"status":"verified"}',
          citations: [],
          endCall: false,
          customerVerified: true,
          serverAccessToken: 'server-only-token',
          serverRole: 'student',
        };
      }),
    };
    const tools = buildLiveKitTools({
      gateway,
      call: verifiedCall,
      onEndCall: vi.fn(),
      onToolAccessChanged: accessChanged,
    });

    await run(tools.search_knowledge, {});

    expect(accessChanged).toHaveBeenCalledOnce();
    const refreshed = buildLiveKitTools({
      gateway,
      call: verifiedCall,
      onEndCall: vi.fn(),
    });
    expect(Object.keys(refreshed)).toContain('student_action');
    expect(gateway.realtimeTools).toHaveBeenLastCalledWith({
      customerVerified: true,
      serverRole: 'student',
    });
  });
});
