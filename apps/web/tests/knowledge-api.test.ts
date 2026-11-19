import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listKnowledgeDocuments,
  saveKnowledgeEntry,
} from '../src/screen/admin/admin-api';
import {
  resetApiClientAdapter,
  useFetchBackedApiClient,
} from './api-client-test-utils';
import type { KnowledgeEntry } from '@tutwithus/contracts/admin';

beforeEach(useFetchBackedApiClient);
afterEach(() => {
  resetApiClientAdapter();
  vi.unstubAllGlobals();
});
const entry: KnowledgeEntry = {
  title: 'Fees',
  topic: 'Pricing',
  translationKey: 'fees',
  language: 'en',
  kind: 'faq',
  answer: 'Ask for the course first.',
  questions: ['What does it cost?'],
  reviewedOn: '2026-11-08',
};
const sourceId = '4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a';
const document = {
  sourceId,
  originalName: 'Fees.txt',
  mimeType: 'text/plain',
  sizeBytes: 100,
  language: 'en',
  status: 'draft',
  chunkCount: 1,
  createdAt: '2026-11-08T00:00:00.000Z',
  entry,
  revision: 1,
};
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('knowledge API client', () => {
  it('loads later pages and retains entry metadata', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ documents: [document], nextCursor: sourceId }),
      )
      .mockResolvedValueOnce(
        json({
          documents: [
            { ...document, sourceId: '5bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a' },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const result = await listKnowledgeDocuments();
    expect(result).toHaveLength(2);
    expect(result[0]?.entry).toEqual(entry);
    expect(fetch.mock.calls[1]?.[0]).toContain(`?after=${sourceId}`);
  });
  it('sends the draft revision and CSRF token when editing', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(document));
    vi.stubGlobal('fetch', fetch);
    await saveKnowledgeEntry(entry, 'csrf-token', { sourceId, revision: 0 });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `/knowledge/entries/${sourceId}`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'X-CSRF-Token': 'csrf-token' },
    });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      entry,
      revision: 0,
    });
  });
});
