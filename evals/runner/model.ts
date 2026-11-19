import OpenAI from 'openai';

export type ToolCallRequest = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; content: string };

export type ModelTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelReply = {
  content: string | null;
  toolCalls: ToolCallRequest[];
};

// The model under test. Tests use a scripted one; `pnpm eval` uses OpenAI.
export interface EvalModel {
  complete(input: {
    messages: ChatMessage[];
    tools: ModelTool[];
    responseInstructions?: string;
  }): Promise<ModelReply>;
}

// A text model, not the realtime voice model: it checks the instructions, the
// tools and the server rules, but not speech, accent or latency.
export class OpenAIEvalModel implements EvalModel {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(input: {
    messages: ChatMessage[];
    tools: ModelTool[];
    responseInstructions?: string;
  }): Promise<ModelReply> {
    const messages = input.messages.map(
      (message): OpenAI.ChatCompletionMessageParam => {
        if (message.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: message.content,
          };
        }
        if (message.role === 'assistant') {
          return {
            role: 'assistant',
            content: message.content,
            ...(message.toolCalls.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function' as const,
                    function: { name: call.name, arguments: call.arguments },
                  })),
                }
              : {}),
          };
        }
        return { role: message.role, content: message.content };
      },
    );
    if (input.responseInstructions) {
      const firstSystemMessage = messages.findIndex(
        (message) => message.role === 'system',
      );
      messages.splice(firstSystemMessage + 1, 0, {
        role: 'system',
        content: input.responseInstructions,
      });
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages,
      tools: input.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    });

    const message = completion.choices[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? []).flatMap((call) =>
        call.type === 'function'
          ? [
              {
                id: call.id,
                name: call.function.name,
                arguments: call.function.arguments,
              },
            ]
          : [],
      ),
    };
  }
}
