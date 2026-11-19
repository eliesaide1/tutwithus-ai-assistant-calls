import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocument } from '@tutwithus/contracts/admin';
import { AP_KnowledgePage } from '../src/screen/admin/knowledge/pages/AP_KnowledgePage';
import { messages } from '../src/shared/i18n';

afterEach(cleanup);

function document(
  originalName: string,
  language: KnowledgeDocument['language'],
  status: KnowledgeDocument['status'],
): KnowledgeDocument {
  return {
    sourceId:
      status === 'ready'
        ? '11111111-1111-4111-8111-111111111111'
        : status === 'draft'
          ? '22222222-2222-4222-8222-222222222222'
          : '33333333-3333-4333-8333-333333333333',
    originalName,
    mimeType: 'text/plain',
    language,
    sizeBytes: 1024,
    status,
    chunkCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderPage({
  documents,
  language = 'en',
  onLanguageChange = vi.fn(),
  isAdmin = false,
  onStatusChange = vi.fn(),
}: {
  documents: KnowledgeDocument[];
  language?: 'ar-SA' | 'en' | 'fr';
  onLanguageChange?: (language: 'ar-SA' | 'en' | 'fr') => void;
  isAdmin?: boolean;
  onStatusChange?: (
    document: KnowledgeDocument,
    status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived',
  ) => void;
}) {
  return render(
    <AP_KnowledgePage
      text={messages.en}
      locale="en"
      isAdmin={isAdmin}
      canEdit={isAdmin}
      documents={documents}
      loading={false}
      file={null}
      language={language}
      uploading={false}
      languageOptions={[
        { value: 'ar-SA', label: 'العربية' },
        { value: 'en', label: 'English' },
        { value: 'fr', label: 'Français' },
      ]}
      onFileChange={vi.fn()}
      onLanguageChange={onLanguageChange}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
      onStatusChange={onStatusChange}
      onSaveEntry={vi.fn(async () => undefined)}
    />,
  );
}

describe('knowledge language library', () => {
  it('publishes an administrator draft with one action', () => {
    const draft = document('lesson-prices.txt', 'en', 'draft');
    const onStatusChange = vi.fn();
    renderPage({ documents: [draft], isAdmin: true, onStatusChange });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onStatusChange).toHaveBeenCalledWith(draft, 'published');
    fireEvent.click(screen.getByRole('button', { name: 'Write an article' }));
    expect(screen.getByLabelText('Content')).toBeTruthy();
    expect(screen.queryByLabelText('Entry type')).toBeNull();
  });
  it('isolates documents by selected language and displays per-language counts', () => {
    const documents = [
      document('english-notes.txt', 'en', 'ready'),
      document('arabic-notes.txt', 'ar-SA', 'draft'),
      document('french-notes.txt', 'fr', 'published'),
    ];
    const onLanguageChange = vi.fn();
    const view = renderPage({ documents, onLanguageChange });

    expect(screen.getByText('english-notes.txt')).toBeTruthy();
    expect(screen.queryByText('arabic-notes.txt')).toBeNull();
    expect(screen.queryByText('french-notes.txt')).toBeNull();
    expect(
      screen
        .getByRole('tab', { name: 'Français 1' })
        .getAttribute('aria-selected'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('tab', { name: 'Français 1' }));
    expect(onLanguageChange).toHaveBeenCalledWith('fr');

    view.rerender(
      <AP_KnowledgePage
        text={messages.en}
        locale="en"
        isAdmin={false}
        canEdit={false}
        documents={documents}
        loading={false}
        file={null}
        language="fr"
        uploading={false}
        languageOptions={[
          { value: 'ar-SA', label: 'العربية' },
          { value: 'en', label: 'English' },
          { value: 'fr', label: 'Français' },
        ]}
        onFileChange={vi.fn()}
        onLanguageChange={onLanguageChange}
        onUpload={vi.fn()}
        onRemove={vi.fn()}
        onStatusChange={vi.fn()}
        onSaveEntry={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByText('french-notes.txt')).toBeTruthy();
    expect(screen.queryByText('english-notes.txt')).toBeNull();
  });

  it('treats legacy ready documents as published in the status filter', () => {
    renderPage({
      documents: [
        document('live-content.txt', 'en', 'ready'),
        document('draft-content.txt', 'en', 'draft'),
      ],
    });

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'published' },
    });

    expect(screen.getByText('live-content.txt')).toBeTruthy();
    expect(screen.queryByText('draft-content.txt')).toBeNull();
  });
});
