import {
  AgentSettingsModel,
  type AgentSettingsDraft,
  type AgentSettingsRecord,
} from './agent-settings.model.js';

export interface AgentSettingsRepository {
  getSettings(): Promise<{
    active: AgentSettingsRecord | null;
    drafts: AgentSettingsRecord[];
  }>;
  saveSettingsDraft(settings: AgentSettingsDraft): Promise<AgentSettingsRecord>;
  updateSettingsDraft(
    version: number,
    settings: AgentSettingsDraft,
  ): Promise<AgentSettingsRecord | null>;
  deleteSettingsDraft(version: number): Promise<boolean>;
  activateSettings(
    version: number,
    activatedBy: string,
    at: Date,
  ): Promise<boolean>;
}

export class MongoAgentSettingsRepository implements AgentSettingsRepository {
  async getSettings(): Promise<{
    active: AgentSettingsRecord | null;
    drafts: AgentSettingsRecord[];
  }> {
    const [active, drafts] = await Promise.all([
      AgentSettingsModel.findOne({ status: 'active' }).lean().exec(),
      AgentSettingsModel.find({ status: { $in: ['draft', 'archived'] } })
        .sort({ version: -1 })
        .limit(50)
        .lean()
        .exec(),
    ]);
    return { active, drafts };
  }

  async saveSettingsDraft(
    settings: AgentSettingsDraft,
  ): Promise<AgentSettingsRecord> {
    const latest = await AgentSettingsModel.findOne()
      .sort({ version: -1 })
      .select('version')
      .lean()
      .exec();
    const record = await AgentSettingsModel.create({
      ...settings,
      version: (latest?.version ?? 0) + 1,
      status: 'draft',
    });
    return record.toObject();
  }

  async updateSettingsDraft(
    version: number,
    settings: AgentSettingsDraft,
  ): Promise<AgentSettingsRecord | null> {
    const record = await AgentSettingsModel.findOneAndUpdate(
      { version, status: 'draft' },
      { $set: settings },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
    return record;
  }

  async deleteSettingsDraft(version: number): Promise<boolean> {
    const result = await AgentSettingsModel.deleteOne({
      version,
    }).exec();
    return result.deletedCount === 1;
  }

  async activateSettings(
    version: number,
    activatedBy: string,
    at: Date,
  ): Promise<boolean> {
    const draft = await AgentSettingsModel.findOne({
      version,
      status: { $in: ['draft', 'archived'] },
    })
      .select('_id')
      .lean()
      .exec();
    if (!draft) {
      return false;
    }

    await AgentSettingsModel.updateOne(
      { status: 'active' },
      { $set: { status: 'archived' } },
    ).exec();
    const activated = await AgentSettingsModel.updateOne(
      { _id: draft._id, status: 'draft' },
      { $set: { status: 'active', activatedBy, activatedAt: at } },
    ).exec();
    return activated.modifiedCount === 1;
  }
}
