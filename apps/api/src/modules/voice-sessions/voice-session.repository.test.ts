import { describe, expect, it } from 'vitest';
import { buildAdminConversationMatch } from './voice-session.repository.js';

describe('admin conversation query', () => {
  it('excludes consent sessions that never started a call', () => {
    expect(buildAdminConversationMatch()).toEqual({
      startedAt: { $exists: true },
    });
  });

  it('applies status and locale filters without including unstarted sessions', () => {
    expect(
      buildAdminConversationMatch({ status: 'active', locale: 'en' }),
    ).toEqual({
      startedAt: { $exists: true },
      locale: 'en',
      endedAt: { $exists: false },
    });
    expect(buildAdminConversationMatch({ status: 'ended' })).toEqual({
      startedAt: { $exists: true },
      endedAt: { $exists: true },
    });
  });
});
