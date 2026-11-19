import type { ChatMessage, EvalModel, ModelReply, ModelTool } from './model.js';

type Step = ModelReply | ((input: { messages: ChatMessage[] }) => ModelReply);

// A model that plays back a fixed script, one step per call, and keeps every
// request it was given. Used by tests; never by `pnpm eval`.
export function scriptedModel(steps: Step[]): EvalModel & {
  requests: Array<{
    messages: ChatMessage[];
    tools: ModelTool[];
    responseInstructions?: string;
  }>;
} {
  const requests: Array<{
    messages: ChatMessage[];
    tools: ModelTool[];
    responseInstructions?: string;
  }> = [];
  let next = 0;
  return {
    requests,
    async complete(input) {
      requests.push({
        messages: [...input.messages],
        tools: input.tools,
        ...(input.responseInstructions
          ? { responseInstructions: input.responseInstructions }
          : {}),
      });
      const step = steps[Math.min(next, steps.length - 1)];
      next += 1;
      if (!step) {
        throw new Error('The script has no steps.');
      }
      return typeof step === 'function' ? step(input) : step;
    },
  };
}

export function say(content: string): ModelReply {
  return { content, toolCalls: [] };
}

export function callTool(
  name: string,
  args: Record<string, unknown>,
  id = `call-${name}`,
): ModelReply {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  };
}
