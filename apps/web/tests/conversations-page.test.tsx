import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AP_ConversationsPage } from '../src/screen/admin/conversations/pages/AP_ConversationsPage.js';
import { messages } from '../src/shared/i18n.js';

const base = {
  locale: 'en' as const,
  status: 'ended' as const,
  transcriptCount: 0,
  startedAt: '2026-11-05T10:00:00.000Z',
  endedAt: '2026-11-05T10:03:00.000Z',
};

function renderPage(
  conversations: Array<{
    sessionId: string;
    channel?: 'browser' | 'whatsapp';
  }>,
) {
  return render(
    <AP_ConversationsPage
      text={messages.en}
      locale="en"
      conversations={conversations.map((conversation) => ({
        ...base,
        ...conversation,
      }))}
      status="all"
      conversationLocale="all"
      selectedId={null}
      selectedConversation={null}
      loading={false}
      loadingDetail={false}
      languageOptions={[{ value: 'en', label: 'English' }]}
      onStatusChange={vi.fn()}
      onLocaleChange={vi.fn()}
      onSelect={vi.fn()}
      onBack={vi.fn()}
    />,
  );
}

describe('AP_ConversationsPage channel label', () => {
  afterEach(cleanup);

  it('marks a WhatsApp call', () => {
    renderPage([
      {
        sessionId: '8f9d1c5e-6a2b-4c1d-9e3f-0a1b2c3d4e5f',
        channel: 'whatsapp',
      },
    ]);

    expect(screen.getAllByText('WhatsApp')).toHaveLength(1);
  });

  it('shows no label for browser calls or records saved before channels existed', () => {
    renderPage([
      { sessionId: '8f9d1c5e-6a2b-4c1d-9e3f-0a1b2c3d4e51', channel: 'browser' },
      { sessionId: '8f9d1c5e-6a2b-4c1d-9e3f-0a1b2c3d4e52' },
    ]);

    expect(screen.queryByText('WhatsApp')).toBeNull();
  });

  it('has a WhatsApp label in every language', async () => {
    const { messages: all } = await import('../src/shared/i18n.js');

    expect(
      Object.values(all).map((entry) => entry.adminChannelWhatsApp),
    ).toEqual(expect.arrayContaining(['WhatsApp', 'واتساب']));
    for (const entry of Object.values(all)) {
      expect(entry.adminChannelWhatsApp.length).toBeGreaterThan(0);
    }
  });
});
