import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AP_KnowledgeEntryEditor } from '../src/screen/admin/knowledge/pages/AP_KnowledgeEntryEditor';
import type { KnowledgeEntry } from '@tutwithus/contracts/admin';

afterEach(cleanup);
const entry: KnowledgeEntry = {
  title: 'Cancellation',
  topic: 'Policies',
  translationKey: 'cancellation',
  language: 'en',
  kind: 'faq',
  answer: 'Cancel 24 hours before.',
  questions: ['Can I cancel?'],
  reviewedOn: '2026-11-08',
};
describe('structured knowledge editor', () => {
  it('uses the selected knowledge language for a new entry', () => {
    render(
      <AP_KnowledgeEntryEditor
        locale="en"
        defaultLanguage="fr"
        onSave={vi.fn(async () => undefined)}
        onCancel={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe(
      'fr',
    );
  });

  it('generates an internal key when adding a language-specific entry', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <AP_KnowledgeEntryEditor
        locale="en"
        defaultLanguage="fr"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Translation key')).toBeNull();
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Politique d’annulation' },
    });
    expect(screen.queryByLabelText('Topic')).toBeNull();
    expect(screen.queryByLabelText('Entry type')).toBeNull();
    expect(
      screen.queryByLabelText('Question variations (one per line)'),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('Content'), {
      target: { value: 'Annulez 24 heures à l’avance.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'fr',
          translationKey: expect.stringMatching(/^knowledge-[a-f0-9-]+$/),
        }),
      ),
    );
  });

  it('saves an edited answer and preserves existing metadata', async () => {
    const onSave = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    render(
      <AP_KnowledgeEntryEditor
        locale="en"
        defaultLanguage="en"
        initial={entry}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText('Content'), {
      target: { value: 'Cancel more than 24 hours before.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        ...entry,
        kind: 'information',
        topic: 'Knowledge',
        questions: [],
        reviewedOn: new Date().toISOString().slice(0, 10),
        answer: 'Cancel more than 24 hours before.',
      }),
    );
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });
  it('keeps the draft open and displays save conflicts', async () => {
    const onCancel = vi.fn();
    render(
      <AP_KnowledgeEntryEditor
        locale="en"
        defaultLanguage="en"
        initial={entry}
        onSave={vi.fn(async () => {
          throw new Error('Draft changed. Refresh first.');
        })}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Draft changed. Refresh first.',
    );
    expect(onCancel).not.toHaveBeenCalled();
  });
  it('converts old prices to visible editable content without keeping hidden prices', async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <AP_KnowledgeEntryEditor
        locale="en"
        defaultLanguage="en"
        initial={{
          ...entry,
          kind: 'pricing',
          price: { amount: 175, currency: 'AED', unit: 'session' },
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText('Content') as HTMLTextAreaElement).value,
    ).toContain('175 AED / Session');
    expect(screen.queryByLabelText('Price amount')).toBeNull();
    fireEvent.change(screen.getByLabelText('Content'), {
      target: { value: 'One session costs 195 AED, including materials.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          answer: 'One session costs 195 AED, including materials.',
          kind: 'information',
        }),
      ),
    );
    expect(onSave).not.toHaveBeenCalledWith(
      expect.objectContaining({ price: expect.anything() }),
    );
  });
});
