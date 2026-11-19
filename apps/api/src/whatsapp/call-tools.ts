import { llm } from '@livekit/agents';
import type { ToolCall, ToolGateway } from '../core/tools/tool-gateway.js';

type CallToolGateway = Pick<ToolGateway, 'realtimeTools' | 'execute'>;

type LiveKitTool = ReturnType<typeof llm.tool>;

// Exposes the shared tool list to the LiveKit agent. The LiveKit tool is only a
// door: the arguments are passed to the same ToolGateway the browser uses, which
// validates them, checks the caller is a verified customer, applies the per-tool
// limit and writes the audit record. Nothing is decided here.
export function buildLiveKitTools(options: {
  gateway: CallToolGateway;
  call: ToolCall;
  onToolAccessChanged?: () => void | Promise<void>;
  // Called when a tool asks to end the call (end_call). The caller decides when
  // to hang up so the goodbye can finish.
  onEndCall: () => void;
}): Record<string, LiveKitTool> {
  const { gateway, call, onEndCall } = options;
  const tools: Record<string, LiveKitTool> = {};

  for (const definition of gateway.realtimeTools({
    customerVerified: call.customerVerified,
    ...(call.serverRole ? { serverRole: call.serverRole } : {}),
  })) {
    tools[definition.name] = llm.tool({
      description: definition.description,
      // The shared tools describe their arguments as JSON Schema.
      parameters: definition.parameters as never,
      execute: async (args: unknown) => {
        const execution = await gateway.execute(
          call,
          definition.name,
          JSON.stringify(args ?? {}),
        );
        if (execution.endCall) {
          onEndCall();
        }
        if (typeof execution.customerVerified === 'boolean') {
          await options.onToolAccessChanged?.();
        }
        if (!execution.followUpInstructions) return execution.output;
        // Carry the same result guidance used by the browser continuation.
        // Do not serialize execution itself: it contains server-only credentials.
        return JSON.stringify({
          result: JSON.parse(execution.output),
          instruction: execution.followUpInstructions,
          continueWithTools: execution.allowToolCalls ?? false,
        });
      },
    });
  }
  return tools;
}
