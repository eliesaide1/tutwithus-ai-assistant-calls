import type {
  AdminConversation,
  AdminConversationSummary,
} from '@tutwithus/contracts/admin';
import { LocaleSchema } from '@tutwithus/contracts';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';
import type { Locale, messages } from '../../../../shared/i18n.js';

type AdminText = (typeof messages)['en'];
type LanguageOption = { value: Locale; label: string };

type AP_ConversationsPageProps = {
  text: AdminText;
  locale: Locale;
  conversations: AdminConversationSummary[];
  status: 'all' | 'active' | 'ended';
  conversationLocale: 'all' | Locale;
  selectedId: string | null;
  selectedConversation: AdminConversation | null;
  loading: boolean;
  loadingDetail: boolean;
  languageOptions: LanguageOption[];
  onStatusChange: (status: 'all' | 'active' | 'ended') => void;
  onLocaleChange: (locale: 'all' | Locale) => void;
  onSelect: (sessionId: string) => void;
  onBack: () => void;
};

function formatConversationTime(
  value: string | undefined,
  locale: Locale,
  includeTime = false,
) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return includeTime
    ? date.toLocaleString(locale)
    : date.toLocaleDateString(locale);
}

export function AP_ConversationsPage({
  text,
  locale,
  conversations,
  status,
  conversationLocale,
  selectedId,
  selectedConversation,
  loading,
  loadingDetail,
  languageOptions,
  onStatusChange,
  onLocaleChange,
  onSelect,
  onBack,
}: AP_ConversationsPageProps) {
  return (
    <section
      className={`ap-admin-conversations${selectedId ? ' ap-admin-conversations--selected' : ''}`}
    >
      <aside className="ap-admin-conversations__sidebar">
        <header className="ap-admin-conversations__heading">
          <div>
            <h2>{text.adminConversations}</h2>
            <p>{text.adminConversationDescription}</p>
          </div>
          <span className="ap-admin-conversations__count">
            {new Intl.NumberFormat(locale).format(conversations.length)}
          </span>
        </header>
        <div className="ap-admin-conversations__filters">
          <AP_FormField label={text.adminFilterStatus}>
            <select
              value={status}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (
                  value === 'all' ||
                  value === 'active' ||
                  value === 'ended'
                ) {
                  onStatusChange(value);
                }
              }}
            >
              <option value="all">{text.adminFilterAll}</option>
              <option value="active">{text.adminConversationActive}</option>
              <option value="ended">{text.adminConversationEnded}</option>
            </select>
          </AP_FormField>
          <AP_FormField label={text.adminFilterLanguage}>
            <select
              value={conversationLocale}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === 'all') {
                  onLocaleChange('all');
                  return;
                }
                const parsed = LocaleSchema.safeParse(value);
                if (parsed.success) {
                  onLocaleChange(parsed.data);
                }
              }}
            >
              <option value="all">{text.adminFilterAll}</option>
              {languageOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </AP_FormField>
        </div>
        <nav
          className="ap-admin-conversations__list"
          aria-label={text.adminConversations}
        >
          {loading ? (
            <AP_LoadingIndicator
              label={text.adminConversationLoading}
              variant="section"
            />
          ) : conversations.length === 0 ? (
            <p className="ap-admin-documents__empty">
              {text.adminNoConversations}
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                className={`ap-admin-conversation${selectedId === conversation.sessionId ? ' ap-admin-conversation--active' : ''}`}
                key={conversation.sessionId}
                onClick={() => onSelect(conversation.sessionId)}
                type="button"
                aria-pressed={selectedId === conversation.sessionId}
              >
                <span
                  className={`ap-admin-conversation__avatar ap-admin-conversation__avatar--${conversation.locale}`}
                >
                  {conversation.locale.slice(0, 2).toUpperCase()}
                </span>
                <span className="ap-admin-conversation__content">
                  <span className="ap-admin-conversation__topline">
                    <strong>
                      {conversation.customerPhone ??
                        text.adminConversationUnknownCustomer}
                    </strong>
                    <time>
                      {formatConversationTime(
                        conversation.endedAt ?? conversation.startedAt,
                        locale,
                      )}
                    </time>
                  </span>
                  <span className="ap-admin-conversation__preview">
                    {text.adminTranscriptMessages.replace(
                      '{count}',
                      new Intl.NumberFormat(locale).format(
                        conversation.transcriptCount,
                      ),
                    )}
                  </span>
                  <span className="ap-admin-conversation__bottomline">
                    <span
                      className={`ap-admin-conversation__status ap-admin-conversation__status--${conversation.status}`}
                    >
                      <span aria-hidden="true" />
                      {conversation.status === 'active'
                        ? text.adminConversationActive
                        : text.adminConversationEnded}
                    </span>
                    {conversation.channel === 'whatsapp' ? (
                      <span className="ap-admin-conversation__channel">
                        {text.adminChannelWhatsApp}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </nav>
      </aside>
      <section
        className="ap-admin-conversations__detail"
        aria-label={text.adminConversationDescription}
      >
        {selectedId ? (
          <>
            <header className="ap-admin-conversation-detail__heading">
              <button
                aria-label={text.adminConversations}
                className="ap-admin-conversation-detail__back"
                onClick={onBack}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              {selectedConversation && (
                <>
                  <span
                    className={`ap-admin-conversation-detail__avatar ap-admin-conversation-detail__avatar--${selectedConversation.locale}`}
                  >
                    {selectedConversation.locale.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="ap-admin-conversation-detail__identity">
                    <strong>
                      {selectedConversation.customerPhone ??
                        text.adminConversationUnknownCustomer}
                    </strong>
                    <small>
                      <span
                        className={`ap-admin-conversation-detail__presence ap-admin-conversation-detail__presence--${selectedConversation.status}`}
                      />
                      {selectedConversation.status === 'active'
                        ? text.adminConversationActive
                        : text.adminConversationEnded}
                      {' · '}
                      {formatConversationTime(
                        selectedConversation.startedAt,
                        locale,
                        true,
                      )}
                    </small>
                  </span>
                </>
              )}
            </header>
            <div className="ap-admin-conversation-detail__body">
              {loadingDetail ? (
                <AP_LoadingIndicator
                  label={text.adminConversationLoading}
                  variant="section"
                />
              ) : selectedConversation?.transcript.length === 0 ? (
                <p className="ap-admin-documents__empty">
                  {text.adminNoTranscript}
                </p>
              ) : selectedConversation ? (
                <ol className="ap-admin-transcript">
                  {selectedConversation.transcript.map((entry, index) => (
                    <li
                      className={`ap-admin-transcript__entry ap-admin-transcript__entry--${entry.speaker}`}
                      key={`${entry.receivedAt}-${index}`}
                    >
                      <strong>
                        {entry.speaker === 'user'
                          ? text.adminConversationCaller
                          : text.adminConversationAssistant}
                      </strong>
                      <p>{entry.text}</p>
                      <time dateTime={entry.receivedAt}>
                        {new Date(entry.receivedAt).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="ap-admin-documents__empty">
                  {text.adminConversationSelect}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="ap-admin-conversations__welcome">
            <span
              className="ap-admin-conversations__welcome-icon"
              aria-hidden="true"
            >
              <svg viewBox="0 0 48 48">
                <path d="M24 7c-9.4 0-17 6.7-17 15 0 4.4 2.2 8.4 5.8 11.1L11 41l9.1-4.8c1.3.3 2.6.5 3.9.5 9.4 0 17-6.7 17-15S33.4 7 24 7Z" />
                <path d="M16 22h.1m7.9 0h.1m7.9 0h.1" />
              </svg>
            </span>
            <p>{text.adminConversationSelect}</p>
          </div>
        )}
      </section>
    </section>
  );
}
