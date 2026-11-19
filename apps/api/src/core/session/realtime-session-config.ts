import type { AgentProfile, AgentVoice } from '../agent/agent-profile.js';
import type { RealtimeToolDefinition } from '../tools/tool-registry.js';

export type RealtimeTurnDetection =
  | {
      type: 'server_vad';
      threshold: number;
      silence_duration_ms: number;
      prefix_padding_ms: number;
      create_response: false;
    }
  | {
      type: 'semantic_vad';
      eagerness: 'auto' | 'low' | 'medium' | 'high';
      create_response: false;
    };

export const DEFAULT_SERVER_VAD = Object.freeze({
  type: 'server_vad' as const,
  threshold: 0.8,
  silence_duration_ms: 500,
  prefix_padding_ms: 300,
  create_response: false as const,
});

export type RealtimeSessionConfiguration = {
  instructions: string;
  outputModalities: ['audio'] | ['text'];
  transcriptionModel: 'gpt-transcribe';
  voice: AgentVoice;
  inputNoiseReduction?: { type: 'far_field' };
  turnDetection?: RealtimeTurnDetection;
  // Defined server-side only; the browser never receives or sets tools.
  tools?: RealtimeToolDefinition[];
};

export function buildRealtimeSessionConfiguration(
  profile: AgentProfile,
  tools: RealtimeToolDefinition[] = [],
): RealtimeSessionConfiguration {
  return {
    instructions: profile.instructions,
    outputModalities: profile.locale === 'ar-SA' ? ['text'] : ['audio'],
    transcriptionModel: 'gpt-transcribe',
    voice: profile.voice,
    inputNoiseReduction: { type: 'far_field' },
    ...(tools.length > 0 ? { tools } : {}),
  };
}
