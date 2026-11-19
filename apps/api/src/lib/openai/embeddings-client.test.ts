import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIEmbeddingsClient } from './embeddings-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI embeddings client', () => {
  it('sends authenticated embedding requests and returns vectors in input order', async () => {
    const embedding = Array<number>(1536).fill(0.25);
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const requestUrl = input instanceof Request ? input.url : String(input);
        expect(requestUrl).toContain('/v1/embeddings');
        expect(init?.method).toBe('POST');

        const headers = new Headers(
          input instanceof Request ? input.headers : init?.headers,
        );
        expect(headers.get('authorization')).toBe('Bearer test-api-key');
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'text-embedding-3-small',
          input: ['first passage', 'second passage'],
          dimensions: 1536,
          encoding_format: 'base64',
        });

        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              { object: 'embedding', index: 1, embedding },
              {
                object: 'embedding',
                index: 0,
                embedding: embedding.map((v) => -v),
              },
            ],
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 4, total_tokens: 4 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpenAIEmbeddingsClient(
      'test-api-key',
      'text-embedding-3-small',
    );
    const vectors = await client.createEmbeddings([
      'first passage',
      'second passage',
    ]);

    expect(vectors).toEqual([embedding.map((value) => -value), embedding]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
