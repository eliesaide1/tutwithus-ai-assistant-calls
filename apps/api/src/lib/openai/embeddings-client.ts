import OpenAI from 'openai';
import { KNOWLEDGE_VECTOR_DIMENSIONS } from '@tutwithus/contracts/admin';

export interface EmbeddingsClient {
  createEmbeddings(input: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingsClient implements EmbeddingsClient {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey, timeout: 5_000, maxRetries: 0 });
  }

  async createEmbeddings(input: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input,
      dimensions: KNOWLEDGE_VECTOR_DIMENSIONS,
    });
    return [...response.data]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }
}
