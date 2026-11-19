import {
  ToolInvocationModel,
  type ToolInvocationRecord,
} from './tool-invocation.model.js';

export interface ToolInvocationRepository {
  record(entry: ToolInvocationRecord): Promise<void>;
}

export class MongoToolInvocationRepository implements ToolInvocationRepository {
  async record(entry: ToolInvocationRecord): Promise<void> {
    await ToolInvocationModel.create(entry);
  }
}
