import type { Dispatch, SetStateAction } from 'react';
import type { Escalation } from '@tutwithus/contracts/admin';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';

type AdminText = (typeof messages)['en'];
type EscalationUpdate = {
  action?: 'claim' | 'resolve' | 'reopen';
  note?: string;
};

type AP_EscalationsPageProps = {
  text: AdminText;
  locale: Locale;
  isAdmin: boolean;
  escalations: Escalation[];
  filter: 'all' | Escalation['status'];
  priorityFilter: 'all' | Escalation['priority'];
  loading: boolean;
  busyAction: string | null;
  noteDrafts: Record<string, string>;
  setFilter: (filter: 'all' | Escalation['status']) => void;
  setPriorityFilter: (filter: 'all' | Escalation['priority']) => void;
  setNoteDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onUpdate: (escalation: Escalation, update: EscalationUpdate) => void;
};

export function AP_EscalationsPage({
  text,
  locale,
  isAdmin,
  escalations,
  filter,
  priorityFilter,
  loading,
  busyAction,
  noteDrafts,
  setFilter,
  setPriorityFilter,
  setNoteDrafts,
  onUpdate,
}: AP_EscalationsPageProps) {
  const statusLabels: Record<Escalation['status'], string> = {
    open: text.adminEscalationOpen,
    claimed: text.adminEscalationClaimed,
    resolved: text.adminEscalationResolved,
  };
  const reasonLabels: Record<Escalation['reason'], string> = {
    out_of_scope: text.adminReasonOutOfScope,
    user_requested: text.adminReasonUserRequested,
    complaint: text.adminReasonComplaint,
    safety: text.adminReasonSafety,
    technical: text.adminReasonTechnical,
  };
  const priorityLabels: Record<Escalation['priority'], string> = {
    low: text.adminPriorityLow,
    normal: text.adminPriorityNormal,
    high: text.adminPriorityHigh,
    urgent: text.adminPriorityUrgent,
  };
  const statusFilters: Array<{
    value: 'all' | Escalation['status'];
    label: string;
    count: number;
  }> = [
    { value: 'all', label: text.adminFilterAll, count: escalations.length },
    ...(['open', 'claimed', 'resolved'] as const).map((status) => ({
      value: status,
      label: statusLabels[status],
      count: escalations.filter((item) => item.status === status).length,
    })),
  ];
  const visibleEscalations = escalations.filter(
    (escalation) =>
      (filter === 'all' || escalation.status === filter) &&
      (priorityFilter === 'all' || escalation.priority === priorityFilter),
  );
  const actionForStatus = (
    escalation: Escalation,
    status: Escalation['status'],
  ): EscalationUpdate | null => {
    if (status === escalation.status) {
      return null;
    }
    if (status === 'claimed' && escalation.status === 'open') {
      return { action: 'claim' };
    }
    if (
      status === 'resolved' &&
      escalation.status !== 'resolved' &&
      (isAdmin || escalation.assignedToCurrentUser)
    ) {
      return { action: 'resolve' };
    }
    if (status === 'open' && escalation.status === 'resolved' && isAdmin) {
      return { action: 'reopen' };
    }
    return null;
  };

  return (
    <>
      <header className="ap-admin-operations__heading">
        <div>
          <h2>{text.adminEscalations}</h2>
          <p>{text.adminEscalationsDescription}</p>
        </div>
        <div className="ap-admin-operations__filters">
          <AP_FormField label={text.adminFilterPriority}>
            <select
              value={priorityFilter}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (
                  value === 'all' ||
                  value === 'low' ||
                  value === 'normal' ||
                  value === 'high' ||
                  value === 'urgent'
                ) {
                  setPriorityFilter(value);
                }
              }}
            >
              <option value="all">{text.adminFilterAll}</option>
              <option value="low">{text.adminPriorityLow}</option>
              <option value="normal">{text.adminPriorityNormal}</option>
              <option value="high">{text.adminPriorityHigh}</option>
              <option value="urgent">{text.adminPriorityUrgent}</option>
            </select>
          </AP_FormField>
        </div>
      </header>

      <nav
        className="ap-escalation-status-tabs"
        aria-label={text.adminFilterStatus}
      >
        {statusFilters.map((status) => (
          <button
            aria-pressed={filter === status.value}
            className={
              filter === status.value
                ? 'ap-escalation-status-tabs__tab ap-escalation-status-tabs__tab--active'
                : 'ap-escalation-status-tabs__tab'
            }
            key={status.value}
            onClick={() => setFilter(status.value)}
            type="button"
          >
            <span>{status.label}</span>
            <span className="ap-escalation-status-tabs__count">
              {status.count}
            </span>
          </button>
        ))}
      </nav>

      {loading ? (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="section"
        />
      ) : visibleEscalations.length === 0 ? (
        <p className="ap-admin-operations__empty">{text.adminNoEscalations}</p>
      ) : (
        <div className="ap-admin-records">
          {visibleEscalations.map((escalation) => (
            <article className="ap-admin-record" key={escalation.id}>
              <header className="ap-admin-record__header">
                <div>
                  <span
                    className={`ap-admin-record__status ap-admin-record__status--${escalation.status}`}
                  >
                    {statusLabels[escalation.status]}
                  </span>
                  <h3>{escalation.summary}</h3>
                </div>
                <span
                  className={`ap-admin-record__priority ap-admin-record__priority--${escalation.priority}`}
                >
                  {priorityLabels[escalation.priority]}
                </span>
              </header>
              <dl className="ap-admin-record__details">
                <div>
                  <dt>{text.adminEscalationReference}</dt>
                  <dd>{escalation.ticketRef}</dd>
                </div>
                <div>
                  <dt>{text.adminEscalationReason}</dt>
                  <dd>{reasonLabels[escalation.reason]}</dd>
                </div>
                <div>
                  <dt>{text.adminSlaDue}</dt>
                  <dd>
                    {new Date(escalation.slaDueAt).toLocaleString(locale)}
                  </dd>
                </div>
                <div>
                  <dt>{text.adminContact}</dt>
                  <dd>
                    {escalation.contactConsent && escalation.contact?.phone ? (
                      <a href={`tel:${escalation.contact.phone}`}>
                        {escalation.contact.phone}
                      </a>
                    ) : (
                      text.adminDisabled
                    )}
                  </dd>
                </div>
              </dl>
              {escalation.notes.length > 0 && (
                <ul className="ap-admin-record__notes">
                  {escalation.notes.map((note, index) => (
                    <li key={`${note.createdAt}-${index}`}>
                      <span>{note.text}</span>
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleString(locale)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              <div className="ap-escalation-status-control">
                <span className="ap-escalation-status-control__label">
                  {text.adminFilterStatus}
                </span>
                <div
                  aria-label={`${text.adminFilterStatus}: ${escalation.ticketRef}`}
                  className="ap-escalation-status-control__options"
                  role="group"
                >
                  {(['open', 'claimed', 'resolved'] as const).map((status) => {
                    const update = actionForStatus(escalation, status);
                    return (
                      <AP_Button
                        aria-pressed={status === escalation.status}
                        className={
                          status === escalation.status
                            ? 'ap-escalation-status-control__button--active'
                            : ''
                        }
                        disabled={
                          busyAction === escalation.id || update === null
                        }
                        key={status}
                        onClick={() => {
                          if (update) {
                            onUpdate(escalation, update);
                          }
                        }}
                        type="button"
                        variant={
                          status === escalation.status ? 'primary' : 'secondary'
                        }
                      >
                        {statusLabels[status]}
                      </AP_Button>
                    );
                  })}
                </div>
              </div>
              {escalation.status !== 'resolved' && (
                <form
                  className="ap-admin-record__note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const note = noteDrafts[escalation.id]?.trim();
                    if (note) {
                      onUpdate(escalation, { note });
                    }
                  }}
                >
                  <input
                    aria-label={`${text.adminAddNote}: ${escalation.ticketRef}`}
                    maxLength={1000}
                    placeholder={text.adminAddNote}
                    value={noteDrafts[escalation.id] ?? ''}
                    onChange={(event) =>
                      setNoteDrafts((current) => ({
                        ...current,
                        [escalation.id]: event.currentTarget.value,
                      }))
                    }
                  />
                  <AP_Button
                    type="submit"
                    disabled={
                      busyAction === escalation.id ||
                      !noteDrafts[escalation.id]?.trim()
                    }
                  >
                    {text.adminSaveNote}
                  </AP_Button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
