import { useState, type FormEvent } from 'react';
import type {
  KnowledgeDocument,
  KnowledgeEntry,
} from '@tutwithus/contracts/admin';
import {
  AP_KnowledgeEntryEditor,
  entryLabels,
} from './AP_KnowledgeEntryEditor.js';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';
import './AP_KnowledgePage.css';

type AdminText = (typeof messages)['en'];
type LanguageOption = { value: Locale; label: string };
type KnowledgeStatus =
  'in_review' | 'draft' | 'approved' | 'published' | 'archived';

type AP_KnowledgePageProps = {
  onSaveEntry: (
    entry: KnowledgeEntry,
    edit?: { sourceId: string; revision: number },
  ) => Promise<void>;
  text: AdminText;
  locale: Locale;
  isAdmin: boolean;
  canEdit: boolean;
  documents: KnowledgeDocument[];
  loading: boolean;
  file: File | null;
  language: Locale;
  uploading: boolean;
  languageOptions: LanguageOption[];
  onFileChange: (file: File | null) => void;
  onLanguageChange: (language: Locale) => void;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (document: KnowledgeDocument) => void;
  onStatusChange: (
    document: KnowledgeDocument,
    status: KnowledgeStatus,
  ) => void;
};

function formatFileSize(bytes: number, locale: Locale): string {
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      bytes / 1024,
    ) + ' KB'
  );
}

export function AP_KnowledgePage({
  text,
  locale,
  isAdmin,
  canEdit,
  documents,
  loading,
  file,
  language,
  uploading,
  languageOptions,
  onFileChange,
  onLanguageChange,
  onUpload,
  onRemove,
  onStatusChange,
  onSaveEntry,
}: AP_KnowledgePageProps) {
  const [editor, setEditor] = useState<{
    initial?: KnowledgeEntry;
    edit?: { sourceId: string; revision: number };
  } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | KnowledgeDocument['status']
  >('all');
  const [contentFilter, setContentFilter] = useState<
    'all' | 'entry' | 'document'
  >('all');
  const labels = entryLabels[locale];
  const languageDocuments = documents.filter(
    (document) => document.language === language,
  );
  const visibleDocuments = languageDocuments.filter((document) => {
    if (
      statusFilter !== 'all' &&
      document.status !== statusFilter &&
      !(statusFilter === 'published' && document.status === 'ready')
    ) {
      return false;
    }
    if (
      contentFilter === 'entry' &&
      (!document.entry || document.status === 'failed')
    ) {
      return false;
    }
    if (contentFilter === 'document' && document.entry) {
      return false;
    }
    const query = search.trim().toLocaleLowerCase(locale);
    if (!query) return true;
    const searchable = [
      document.originalName,
      document.entry?.title,
      document.entry?.topic,
      document.entry?.answer,
      ...(document.entry?.questions ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase(locale);
    return searchable.includes(query);
  });
  const publishedCount = languageDocuments.filter((document) =>
    ['published', 'ready'].includes(document.status),
  ).length;
  const draftCount = languageDocuments.filter(
    (document) => document.status === 'draft',
  ).length;

  function selectLanguage(nextLanguage: Locale) {
    onLanguageChange(nextLanguage);
    setSearch('');
    setStatusFilter('all');
    setContentFilter('all');
    setEditor(null);
  }

  function statusLabel(status: KnowledgeDocument['status']) {
    switch (status) {
      case 'draft':
        return text.adminStatusDraft;
      case 'in_review':
        return text.adminStatusInReview;
      case 'approved':
        return text.adminStatusApproved;
      case 'published':
      case 'ready':
        return text.adminStatusPublished;
      case 'archived':
        return text.adminStatusArchived;
      case 'failed':
        return text.adminRequestError;
    }
  }

  function actionFor(document: KnowledgeDocument) {
    if (
      isAdmin &&
      ['draft', 'in_review', 'approved'].includes(document.status)
    ) {
      return { status: 'published' as const, label: text.adminPublish };
    }
    if (canEdit && document.entry && document.status === 'archived') {
      return { status: 'draft' as const, label: text.adminReturnDraft };
    }
    if (canEdit && document.status === 'draft') {
      return { status: 'in_review' as const, label: text.adminSubmitReview };
    }
    if (canEdit && document.status === 'in_review') {
      return { status: 'draft' as const, label: text.adminReturnDraft };
    }
    if (isAdmin && ['published', 'ready'].includes(document.status)) {
      return { status: 'archived' as const, label: text.adminArchive };
    }
    return null;
  }

  return (
    <div className="ap-knowledge">
      <header className="ap-knowledge__hero">
        <div>
          <p className="ap-knowledge__eyebrow">{text.adminKnowledgeBase}</p>
          <h1>{labels.libraryTitle}</h1>
          <p>{labels.libraryDescription}</p>
        </div>
        <div className="ap-knowledge__summary" aria-label={labels.summary}>
          <div>
            <strong>{languageDocuments.length}</strong>
            <span>{labels.totalItems}</span>
          </div>
          <div>
            <strong>{publishedCount}</strong>
            <span>{text.adminStatusPublished}</span>
          </div>
          <div>
            <strong>{draftCount}</strong>
            <span>{text.adminStatusDraft}</span>
          </div>
        </div>
      </header>

      <section className="ap-knowledge__language-panel">
        <div className="ap-knowledge__language-heading">
          <div>
            <h2>{labels.byLanguage}</h2>
            <p>{labels.byLanguageDescription}</p>
          </div>
          <span>
            {languageDocuments.length} {labels.items}
          </span>
        </div>
        <div
          className="ap-knowledge__language-tabs"
          role="tablist"
          aria-label={labels.language}
        >
          {languageOptions.map((option) => {
            const count = documents.filter(
              (document) => document.language === option.value,
            ).length;
            const selected = language === option.value;
            return (
              <button
                type="button"
                role="tab"
                id={`knowledge-language-${option.value}`}
                aria-selected={selected}
                aria-controls="knowledge-language-content"
                className={`ap-knowledge__language-tab${selected ? ' ap-knowledge__language-tab--active' : ''}`}
                key={option.value}
                onClick={() => selectLanguage(option.value)}
              >
                <span>{option.label}</span>
                <span className="ap-knowledge__tab-count">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {canEdit && (
        <div className="ap-knowledge__actions">
          <AP_Button
            variant="primary"
            onClick={() => {
              setEditor({});
              setUploadOpen(false);
            }}
          >
            {labels.new}
          </AP_Button>
          <AP_Button
            onClick={() => {
              setUploadOpen((open) => !open);
              setEditor(null);
            }}
            aria-expanded={uploadOpen}
            aria-controls="knowledge-upload-panel"
          >
            {uploadOpen ? labels.closeUpload : text.adminUploadDocument}
          </AP_Button>
        </div>
      )}

      {canEdit && editor && (
        <AP_KnowledgeEntryEditor
          key={editor.edit?.sourceId ?? editor.initial?.language ?? 'new'}
          locale={locale}
          defaultLanguage={language}
          initial={editor.initial}
          onCancel={() => setEditor(null)}
          onSave={(entry) => onSaveEntry(entry, editor.edit)}
        />
      )}
      {canEdit && uploadOpen && (
        <section
          className="ap-admin-panel"
          id="knowledge-upload-panel"
          aria-labelledby="knowledge-upload-title"
        >
          <div className="ap-admin-panel__heading">
            <div>
              <p className="ap-admin-panel__eyebrow">{text.adminAddContent}</p>
              <h2 id="knowledge-upload-title">{text.adminUploadDocument}</h2>
            </div>
            <span className="ap-admin-panel__format">PDF · DOCX · TXT</span>
          </div>
          <form className="ap-admin-upload" onSubmit={onUpload}>
            <label className="ap-admin-upload__file" htmlFor="knowledge-file">
              <span className="ap-admin-upload__icon" aria-hidden="true">
                ↑
              </span>
              <span>
                <strong>{file?.name ?? text.adminChooseFile}</strong>
                <small>{text.adminFileRequirements}</small>
              </span>
              <span className="ap-admin-upload__browse">
                {text.adminBrowseFiles}
              </span>
            </label>
            <input
              id="knowledge-file"
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) =>
                onFileChange(event.currentTarget.files?.[0] ?? null)
              }
            />
            <div className="ap-admin-upload__actions">
              <div className="ap-knowledge__upload-language">
                <span>{text.adminDocumentLanguage}</span>
                <strong>
                  {
                    languageOptions.find((option) => option.value === language)
                      ?.label
                  }
                </strong>
              </div>
              <AP_Button
                variant="primary"
                type="submit"
                disabled={uploading || !file}
              >
                {text.adminUploadAndIndex}
              </AP_Button>
            </div>
          </form>
          <p className="ap-admin-panel__privacy">{text.adminUploadPrivacy}</p>
        </section>
      )}

      <section
        id="knowledge-language-content"
        role="tabpanel"
        aria-labelledby={`knowledge-language-${language} documents-list-title`}
        className="ap-admin-documents"
      >
        <header className="ap-admin-documents__heading">
          <div>
            <h2 id="documents-list-title">{labels.list}</h2>
            <p>{labels.description}</p>
          </div>
          <span>
            {text.adminTotalCount.replace(
              '{count}',
              new Intl.NumberFormat(locale).format(visibleDocuments.length),
            )}
          </span>
        </header>
        <div className="ap-knowledge__filters">
          <label className="ap-knowledge__search">
            <span>{labels.search}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder={labels.searchPlaceholder}
            />
          </label>
          <label>
            <span>{labels.statusFilter}</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.currentTarget.value as
                    'all' | KnowledgeDocument['status'],
                )
              }
            >
              <option value="all">{labels.allStatuses}</option>
              {(
                [
                  'draft',
                  'in_review',
                  'approved',
                  'published',
                  'archived',
                  'failed',
                ] as const
              ).map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{labels.contentFilter}</span>
            <select
              value={contentFilter}
              onChange={(event) =>
                setContentFilter(
                  event.currentTarget.value as 'all' | 'entry' | 'document',
                )
              }
            >
              <option value="all">{labels.allContent}</option>
              <option value="entry">{labels.structuredEntries}</option>
              <option value="document">{labels.uploadedDocuments}</option>
            </select>
          </label>
        </div>
        {loading ? (
          <AP_LoadingIndicator
            label={text.adminLoadingDocuments}
            variant="section"
          />
        ) : languageDocuments.length === 0 ? (
          <p className="ap-admin-documents__empty">{labels.empty}</p>
        ) : visibleDocuments.length === 0 ? (
          <p className="ap-admin-documents__empty">{labels.noMatches}</p>
        ) : (
          <div className="ap-admin-documents__list">
            {visibleDocuments.map((document) => {
              const action = actionFor(document);
              return (
                <article className="ap-admin-document" key={document.sourceId}>
                  <span className="ap-admin-document__type" aria-hidden="true">
                    {document.entry
                      ? labels.article
                      : document.mimeType === 'application/pdf'
                        ? 'PDF'
                        : document.mimeType === 'text/plain'
                          ? 'TXT'
                          : 'DOC'}
                  </span>
                  <div className="ap-admin-document__details">
                    <strong>
                      {document.entry?.title ?? document.originalName}
                    </strong>
                    {document.entry && (
                      <details>
                        <summary>{labels.preview}</summary>
                        <p style={{ whiteSpace: 'pre-wrap' }}>
                          {document.entry.answer}
                        </p>
                        {document.entry.course && (
                          <p>
                            {document.entry.course.name} ·{' '}
                            {document.entry.course.level} ·{' '}
                            {document.entry.course.sessions} {labels.sessions}
                          </p>
                        )}
                        {document.entry.price && (
                          <p>
                            {document.entry.price.amount}{' '}
                            {document.entry.price.currency} /{' '}
                            {
                              labels.units[
                                ['session', 'bundle', 'course'].indexOf(
                                  document.entry.price.unit,
                                )
                              ]
                            }
                          </p>
                        )}
                        <p>
                          {labels.reviewed}: {document.entry.reviewedOn}
                        </p>
                      </details>
                    )}
                    <span>
                      {formatFileSize(document.sizeBytes, locale)} ·{' '}
                      {
                        languageOptions.find(
                          (option) => option.value === document.language,
                        )?.label
                      }
                    </span>
                  </div>
                  <span
                    className={`ap-admin-document__status ap-admin-document__status--${document.status}`}
                  >
                    {statusLabel(document.status)}
                  </span>
                  <div className="ap-admin-document__actions">
                    {canEdit &&
                      document.entry &&
                      document.status === 'draft' && (
                        <AP_Button
                          onClick={() =>
                            setEditor({
                              initial: document.entry,
                              edit: {
                                sourceId: document.sourceId,
                                revision: document.revision ?? 0,
                              },
                            })
                          }
                        >
                          {labels.edit}
                        </AP_Button>
                      )}
                    {action && (
                      <AP_Button
                        onClick={() => onStatusChange(document, action.status)}
                      >
                        {action.label}
                      </AP_Button>
                    )}
                    {isAdmin && (
                      <AP_Button
                        variant="danger"
                        aria-label={text.adminRemoveDocument.replace(
                          '{name}',
                          document.originalName,
                        )}
                        onClick={() => onRemove(document)}
                      >
                        {text.adminRemove}
                      </AP_Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="ap-admin-panel__privacy">
          {text.adminKnowledgeReviewNote}
        </p>
      </section>
    </div>
  );
}
