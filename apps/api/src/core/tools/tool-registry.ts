import type { Locale } from '@tutwithus/contracts';
import { z } from 'zod';

export type Citation = { sourceId: string; title: string };

// Everything a tool may know about the call it runs in. Built by the server,
// never taken from the model or the browser.
export type ToolContext = {
  sessionId: string;
  locale: Locale;
  // Browser-detected IANA zone persisted with the session. UTC remains the
  // compatibility fallback for legacy records and non-browser channels.
  timeZone?: string;
  retrieval: { topK: number; minScore: number };
  // Text the agent may say about when staff will respond (from settings).
  responseExpectation: string;
  accountAccessHint?: string;
  verificationAvailable?: boolean;
  actionUnavailableMessage?: string;
};

export type ToolRunContext = ToolContext & {
  callsMade: number;
  // Ephemeral credential available only to server-side protected tools.
  serverAccessToken?: string;
  serverRole?: string;
};

export type ToolAccess =
  { kind: 'public' } | { kind: 'roles'; roles: readonly string[] };

export type ToolOutcome = {
  // JSON-serializable result returned to the model.
  output: unknown;
  citations?: Citation[];
  // Hang up once the model has said goodbye.
  endCall?: boolean;
  customerVerified?: boolean;
  // Consumed by ToolGateway; never included in output or invocation records.
  serverAccessToken?: string;
  serverRole?: string;
  accountAccessHint?: string;
  // Allows a protected action to continue in the same response after verification.
  allowToolCalls?: boolean;
  // Optional one-turn instruction controlled by the server after the result.
  // Used when a confirmation must be spoken exactly once.
  followUpInstructions?: string;
  // The next caller transcript is expected to contain sensitive input and
  // must not be persisted.
  sensitiveInputExpected?: boolean;
};

export type ToolInvokeResult =
  | { kind: 'invalid' }
  | { kind: 'ok'; argsRedacted: unknown; outcome: ToolOutcome };

// A tool with its argument type erased, so tools of different shapes share one list.
export type RegisteredTool = {
  name: string;
  description: string;
  access: ToolAccess;
  maxCallsPerSession: number;
  canCallAfter?: (previousStatus: string | undefined) => boolean;
  // Denied unless the call has been matched to a registered customer.
  requiresVerifiedCustomer: boolean;
  // JSON Schema sent to the model as the tool's parameters.
  parameters: Record<string, unknown>;
  invoke(
    rawArguments: unknown,
    context: ToolRunContext,
  ): Promise<ToolInvokeResult>;
};

// The tool entry the Realtime API expects in `session.tools`.
export type RealtimeToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export function defineTool<Schema extends z.ZodType>(definition: {
  name: string;
  description: string;
  access: ToolAccess;
  parameters: Schema;
  maxCallsPerSession: number;
  canCallAfter?: (previousStatus: string | undefined) => boolean;
  requiresVerifiedCustomer?: boolean;
  // Removes personal data before the arguments are logged. Defaults to
  // logging nothing from the arguments.
  redact?: (args: z.infer<Schema>) => unknown;
  execute: (
    args: z.infer<Schema>,
    context: ToolRunContext,
  ) => Promise<ToolOutcome>;
}): RegisteredTool {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(
    definition.parameters,
  ) as Record<string, unknown>;

  return {
    name: definition.name,
    description: definition.description,
    access: definition.access,
    maxCallsPerSession: definition.maxCallsPerSession,
    ...(definition.canCallAfter
      ? { canCallAfter: definition.canCallAfter }
      : {}),
    requiresVerifiedCustomer: definition.requiresVerifiedCustomer ?? false,
    parameters: jsonSchema,
    async invoke(rawArguments, context) {
      const parsed = definition.parameters.safeParse(rawArguments);
      if (!parsed.success) {
        return { kind: 'invalid' };
      }
      return {
        kind: 'ok',
        argsRedacted: definition.redact ? definition.redact(parsed.data) : {},
        outcome: await definition.execute(parsed.data, context),
      };
    },
  };
}

export function toRealtimeTools(
  tools: readonly RegisteredTool[],
): RealtimeToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
