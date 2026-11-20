import { describe, expect, it } from 'vitest';
import {
  AdminConversationSchema,
  AdminConversationSummarySchema,
} from './admin.js';

const base = {
  sessionId: '7b330699-d910-42cc-9758-7328a4eebafd',
  locale: 'en' as const,
  status: 'ended' as const,
  transcriptCount: 0,
  customerPhone: '+••••••5587',
};

describe('admin conversation contracts', () => {
  it('carries the full caller number on the detail view', () => {
    const parsed = AdminConversationSchema.parse({
      ...base,
      callerPhone: '+9617005587',
      transcript: [],
    });
    expect(parsed.callerPhone).toBe('+9617005587');
    // The masked value stays alongside it rather than being replaced.
    expect(parsed.customerPhone).toBe('+••••••5587');
  });

  it('keeps the full number out of the conversation list', () => {
    // The list is read a hundred rows at a time; opening one conversation is
    // the deliberate act. Anything extra here would be stripped, but this
    // asserts the boundary rather than trusting it.
    const parsed = AdminConversationSummarySchema.parse({
      ...base,
      callerPhone: '+9617005587',
    });
    expect(parsed).not.toHaveProperty('callerPhone');
    expect(parsed.customerPhone).toBe('+••••••5587');
  });

  it('allows a conversation with no caller number at all', () => {
    const parsed = AdminConversationSchema.parse({
      sessionId: base.sessionId,
      locale: 'en',
      status: 'active',
      transcriptCount: 0,
      transcript: [],
    });
    expect(parsed.callerPhone).toBeUndefined();
    expect(parsed.customerPhone).toBeUndefined();
  });
});
