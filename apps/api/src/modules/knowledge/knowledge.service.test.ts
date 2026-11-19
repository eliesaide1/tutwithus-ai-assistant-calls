import { describe, expect, it } from 'vitest';
import { canTransitionKnowledgeStatus } from './knowledge.service.js';

describe('article publishing permissions', () => {
  it.each(['draft', 'in_review', 'approved'] as const)(
    'lets administrators publish %s directly',
    (status) => {
      expect(canTransitionKnowledgeStatus(status, 'published', 'admin')).toBe(
        true,
      );
      expect(canTransitionKnowledgeStatus(status, 'published', 'editor')).toBe(
        false,
      );
      expect(canTransitionKnowledgeStatus(status, 'published', 'viewer')).toBe(
        false,
      );
    },
  );
  it('requires an archived article to return to draft before publishing', () => {
    expect(canTransitionKnowledgeStatus('archived', 'published', 'admin')).toBe(
      false,
    );
    expect(canTransitionKnowledgeStatus('archived', 'draft', 'admin')).toBe(
      true,
    );
  });
});
