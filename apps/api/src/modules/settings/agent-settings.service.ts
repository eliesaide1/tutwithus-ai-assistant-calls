import type { AgentProfileSettings } from '../../core/agent/agent-profile.js';
import type { AgentSettingsRepository } from './agent-settings.repository.js';

export type ActiveAgentSettings = AgentProfileSettings & {
  maxCallSec: number;
  retrieval?: { topK: number; minScore: number };
};

export interface AgentProfileSettingsReader {
  getActiveAgentSettings(): Promise<ActiveAgentSettings | null>;
}

export class AgentSettingsService implements AgentProfileSettingsReader {
  constructor(private readonly repository: AgentSettingsRepository) {}

  async getActiveAgentSettings(): Promise<ActiveAgentSettings | null> {
    const settings = await this.repository.getSettings();
    return settings.active;
  }
}
