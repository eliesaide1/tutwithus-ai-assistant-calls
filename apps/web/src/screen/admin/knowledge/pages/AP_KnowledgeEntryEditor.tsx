import { useState, type FormEvent } from 'react';
import {
  KnowledgeEntrySchema,
  type KnowledgeEntry,
} from '@tutwithus/contracts/admin';
import type { Locale } from '@tutwithus/contracts';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';

export const entryLabels = {
  en: {
    heading: 'Write an article',
    article: 'Article',
    preview: 'Read article',
    title: 'Title',
    language: 'Language',
    answer: 'Content',
    reviewed: 'Review date',
    sessions: 'Number of sessions',
    save: 'Save draft',
    cancel: 'Cancel',
    edit: 'Edit draft',
    new: 'Write an article',
    notice:
      'Keep one topic per article. Write clear facts or bullet points. For prices, include the amount, currency, what it covers and any conditions. Check your content, then publish it from the library.',
    error: 'Could not save the entry. Please try again.',
    validation: 'Add a title and content (up to 6,000 characters).',
    units: ['Session', 'Bundle', 'Course'],
    list: 'Articles and files',
    description: 'Keep information and prices clear, accurate and up to date.',
    empty:
      'Add your first article or upload a file. Publish it when it is ready for callers.',
    libraryTitle: 'Knowledge library',
    libraryDescription:
      'Keep approved answers organized by language and manage every item from one place.',
    summary: 'Knowledge summary',
    totalItems: 'Items',
    byLanguage: 'Browse by language',
    byLanguageDescription:
      'Write or upload knowledge in the language you choose.',
    items: 'items',
    search: 'Search knowledge',
    searchPlaceholder: 'Search titles and content',
    statusFilter: 'Status',
    allStatuses: 'All statuses',
    contentFilter: 'Content type',
    allContent: 'All content',
    structuredEntries: 'Articles',
    uploadedDocuments: 'Uploaded files',
    noMatches: 'No items match these filters.',
    closeUpload: 'Close upload form',
  },
  fr: {
    heading: 'Rédiger un article',
    article: 'Article',
    preview: 'Lire l’article',
    title: 'Titre',
    language: 'Langue',
    answer: 'Contenu',
    reviewed: 'Date de révision',
    sessions: 'Nombre de séances',
    save: 'Enregistrer le brouillon',
    cancel: 'Annuler',
    edit: 'Modifier le brouillon',
    new: 'Rédiger un article',
    notice:
      'Un sujet par article. Utilisez des phrases simples ou des listes. Pour les tarifs, précisez le montant, la devise, la prestation et les conditions. Vérifiez le contenu puis publiez-le depuis la bibliothèque.',
    error: 'Enregistrement impossible. Veuillez réessayer.',
    validation: 'Ajoutez un titre et un contenu (6 000 caractères maximum).',
    units: ['Séance', 'Forfait', 'Cours'],
    list: 'Articles et fichiers',
    description: 'Gérez les réponses approuvées, cours, tarifs et documents.',
    empty: 'Aucune connaissance. Créez une fiche ou importez un document.',
    libraryTitle: 'Bibliothèque de connaissances',
    libraryDescription:
      'Organisez les réponses par langue et gérez chaque élément au même endroit.',
    summary: 'Résumé des connaissances',
    totalItems: 'Éléments',
    byLanguage: 'Parcourir par langue',
    byLanguageDescription:
      'Chaque langue possède ses propres fiches et documents sources.',
    items: 'éléments',
    search: 'Rechercher',
    searchPlaceholder: 'Rechercher dans les titres et le contenu',
    statusFilter: 'Statut',
    allStatuses: 'Tous les statuts',
    contentFilter: 'Type de contenu',
    allContent: 'Tout le contenu',
    structuredEntries: 'Articles',
    uploadedDocuments: 'Fichiers importés',
    noMatches: 'Aucun élément ne correspond à ces filtres.',
    closeUpload: 'Fermer le formulaire',
  },
  'ar-SA': {
    heading: 'كتابة مقال',
    article: 'مقال',
    preview: 'قراءة المقال',
    title: 'العنوان',
    language: 'اللغة',
    answer: 'المحتوى',
    reviewed: 'تاريخ المراجعة',
    sessions: 'عدد الجلسات',
    save: 'حفظ المسودة',
    cancel: 'إلغاء',
    edit: 'تعديل المسودة',
    new: 'كتابة مقال',
    notice:
      'موضوع واحد لكل مقال. اكتب معلومات واضحة أو نقاطًا قصيرة. للأسعار، اذكر المبلغ والعملة والخدمة والشروط. راجع المحتوى ثم انشره من المكتبة.',
    error: 'تعذر الحفظ. حاول مرة أخرى.',
    validation: 'أضف عنوانًا ومحتوى (حتى ٦٠٠٠ حرف).',
    units: ['جلسة', 'باقة', 'دورة'],
    list: 'المعرفة والمستندات',
    description: 'إدارة الإجابات المعتمدة والدورات والأسعار والمستندات.',
    empty: 'لا توجد معرفة بعد. أضف محتوى أو ارفع مستنداً.',
    libraryTitle: 'مكتبة المعرفة',
    libraryDescription: 'نظّم الإجابات حسب اللغة وأدر كل المحتوى من مكان واحد.',
    summary: 'ملخص المعرفة',
    totalItems: 'العناصر',
    byLanguage: 'تصفّح حسب اللغة',
    byLanguageDescription: 'لكل لغة محتواها ومستنداتها الخاصة.',
    items: 'عناصر',
    search: 'البحث في المعرفة',
    searchPlaceholder: 'ابحث في العناوين والمحتوى',
    statusFilter: 'الحالة',
    allStatuses: 'كل الحالات',
    contentFilter: 'نوع المحتوى',
    allContent: 'كل المحتوى',
    structuredEntries: 'المقالات',
    uploadedDocuments: 'الملفات المرفوعة',
    noMatches: 'لا توجد عناصر تطابق عوامل التصفية.',
    closeUpload: 'إغلاق نموذج الرفع',
  },
};

export function AP_KnowledgeEntryEditor({
  locale,
  initial,
  defaultLanguage,
  onSave,
  onCancel,
}: {
  locale: Locale;
  initial?: KnowledgeEntry;
  defaultLanguage: Locale;
  onSave: (entry: KnowledgeEntry) => Promise<void>;
  onCancel: () => void;
}) {
  const t = entryLabels[locale];
  const [translationKey] = useState(
    () =>
      initial?.translationKey ?? `knowledge-${globalThis.crypto.randomUUID()}`,
  );
  // Move legacy typed facts into editable prose so no hidden old price can
  // override the content that an administrator sees and changes.
  const initialContent = [
    initial?.answer,
    initial?.course &&
      `${initial.course.name} · ${initial.course.level} · ${initial.course.sessions} ${t.sessions}`,
    initial?.price &&
      `${initial.price.amount} ${initial.price.currency} / ${t.units[['session', 'bundle', 'course'].indexOf(initial.price.unit)]}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const [content, setContent] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const parsed = KnowledgeEntrySchema.safeParse({
      title: String(form.get('title') ?? '').trim(),
      language: form.get('language'),
      answer: content,
      translationKey,
    });
    if (!parsed.success) {
      setError(t.validation);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(parsed.data);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="ap-admin-panel ap-knowledge-editor"
      aria-label={t.heading}
    >
      <h2>{t.heading}</h2>
      <p className="ap-knowledge-editor__help">{t.notice}</p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="ap-knowledge-editor__fields">
          <AP_FormField label={t.title}>
            <input
              name="title"
              required
              maxLength={150}
              defaultValue={initial?.title}
            />
          </AP_FormField>
          <AP_FormField label={t.language}>
            <select
              name="language"
              defaultValue={initial?.language ?? defaultLanguage}
            >
              <option value="ar-SA">العربية</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </AP_FormField>
          <AP_FormField label={t.answer}>
            <textarea
              name="answer"
              required
              rows={12}
              maxLength={6000}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              aria-describedby="knowledge-content-count"
            />
          </AP_FormField>
          <small id="knowledge-content-count">
            {content.length.toLocaleString(locale)} /{' '}
            {(6000).toLocaleString(locale)}
          </small>
          {error && <p role="alert">{error}</p>}
          <div className="ap-admin-upload__actions">
            <AP_Button type="submit" variant="primary" disabled={busy}>
              {t.save}
            </AP_Button>
            <AP_Button type="button" onClick={onCancel} disabled={busy}>
              {t.cancel}
            </AP_Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
