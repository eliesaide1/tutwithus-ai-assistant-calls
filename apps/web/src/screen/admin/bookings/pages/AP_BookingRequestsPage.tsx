import type { Dispatch, SetStateAction } from 'react';
import type {
  AdminManagedUser,
  BookingRequest,
} from '@tutwithus/contracts/admin';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';

type AdminText = (typeof messages)['en'];
type BookingUpdate = {
  status?: BookingRequest['status'];
  assigneeId?: string | null;
  note?: string;
};

type AP_BookingRequestsPageProps = {
  text: AdminText;
  locale: Locale;
  isAdmin: boolean;
  isAgent: boolean;
  bookings: BookingRequest[];
  users: AdminManagedUser[];
  filter: 'all' | BookingRequest['status'];
  loading: boolean;
  busyAction: string | null;
  noteDrafts: Record<string, string>;
  setFilter: (filter: 'all' | BookingRequest['status']) => void;
  setNoteDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onUpdate: (booking: BookingRequest, update: BookingUpdate) => void;
};

export function AP_BookingRequestsPage({
  text,
  locale,
  isAdmin,
  isAgent,
  bookings,
  users,
  filter,
  loading,
  busyAction,
  noteDrafts,
  setFilter,
  setNoteDrafts,
  onUpdate,
}: AP_BookingRequestsPageProps) {
  const statusLabels: Record<BookingRequest['status'], string> = {
    draft: text.adminBookingDraft,
    submitted: text.adminBookingSubmitted,
    confirmed: text.adminBookingConfirmed,
    cancelled: text.adminBookingCancelled,
    handled: text.adminBookingHandled,
  };

  return (
    <>
      <header className="ap-admin-operations__heading">
        <div>
          <h2>{text.adminBookings}</h2>
          <p>{text.adminBookingsDescription}</p>
        </div>
        <AP_FormField label={text.adminFilterStatus}>
          <select
            value={filter}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (
                value === 'all' ||
                value === 'draft' ||
                value === 'submitted' ||
                value === 'confirmed' ||
                value === 'cancelled' ||
                value === 'handled'
              ) {
                setFilter(value);
              }
            }}
          >
            <option value="all">{text.adminFilterAll}</option>
            <option value="draft">{text.adminBookingDraft}</option>
            <option value="submitted">{text.adminBookingSubmitted}</option>
            <option value="confirmed">{text.adminBookingConfirmed}</option>
            <option value="cancelled">{text.adminBookingCancelled}</option>
            <option value="handled">{text.adminBookingHandled}</option>
          </select>
        </AP_FormField>
      </header>

      {loading ? (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="section"
        />
      ) : bookings.length === 0 ? (
        <p className="ap-admin-operations__empty">{text.adminNoBookings}</p>
      ) : (
        <div className="ap-admin-records">
          {bookings.map((booking) => (
            <article className="ap-admin-record" key={booking.id}>
              <header className="ap-admin-record__header">
                <div>
                  <span
                    className={`ap-admin-record__status ap-admin-record__status--${booking.status}`}
                  >
                    {statusLabels[booking.status]}
                  </span>
                  <h3>{booking.subject}</h3>
                </div>
                <time dateTime={booking.createdAt}>
                  {new Date(booking.createdAt).toLocaleString(locale)}
                </time>
              </header>
              <dl className="ap-admin-record__details">
                <div>
                  <dt>{text.adminBookingReference}</dt>
                  <dd>{booking.reference}</dd>
                </div>
                <div>
                  <dt>{text.adminLevel}</dt>
                  <dd>{booking.level}</dd>
                </div>
                {booking.curriculum && (
                  <div>
                    <dt>{text.adminCurriculum}</dt>
                    <dd>{booking.curriculum}</dd>
                  </div>
                )}
                {booking.tutorName && (
                  <div>
                    <dt>{text.adminTutor}</dt>
                    <dd>{booking.tutorName}</dd>
                  </div>
                )}
                {booking.sessionStart && booking.sessionEnd && (
                  <div>
                    <dt>{text.adminSessionTime}</dt>
                    <dd>
                      {new Date(booking.sessionStart).toLocaleString(locale, {
                        timeZone: booking.timezone,
                      })}
                      {' – '}
                      {new Date(booking.sessionEnd).toLocaleTimeString(locale, {
                        timeZone: booking.timezone,
                      })}
                      {' · '}
                      {booking.timezone}
                    </dd>
                  </div>
                )}
                {booking.customerId && (
                  <div>
                    <dt>{text.adminCustomerReference}</dt>
                    <dd>{booking.customerId}</dd>
                  </div>
                )}
                <div>
                  <dt>{text.adminPreferredTimes}</dt>
                  <dd>
                    {booking.preferredTimes.join(', ')} · {booking.timezone}
                  </dd>
                </div>
                <div>
                  <dt>{text.adminContact}</dt>
                  <dd>
                    {booking.contactName ||
                    booking.contactEmail ||
                    booking.contactPhone
                      ? [
                          booking.contactName,
                          booking.contactEmail,
                          booking.contactPhone,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : booking.customerId
                        ? text.adminContactNotProvided
                        : text.adminContactRestricted}
                  </dd>
                </div>
                <div>
                  <dt>{text.adminAssignedTo}</dt>
                  <dd>
                    {booking.assigneeId
                      ? (users.find((user) => user.id === booking.assigneeId)
                          ?.email ?? booking.assigneeId)
                      : text.adminUnassigned}
                  </dd>
                </div>
              </dl>
              {booking.notes.length > 0 && (
                <ul className="ap-admin-record__notes">
                  {booking.notes.map((note, index) => (
                    <li key={`${note.createdAt}-${index}`}>
                      <span>{note.text}</span>
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleString(locale)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
              <div className="ap-admin-record__actions">
                {isAdmin ? (
                  <AP_FormField label={text.adminAssignedTo}>
                    <select
                      aria-label={`${text.adminAssignedTo}: ${booking.reference}`}
                      value={booking.assigneeId ?? ''}
                      onChange={(event) =>
                        onUpdate(booking, {
                          assigneeId: event.currentTarget.value || null,
                        })
                      }
                      disabled={busyAction === booking.id}
                    >
                      <option value="">{text.adminUnassigned}</option>
                      {users
                        .filter(
                          (user) =>
                            !user.disabled &&
                            (user.role === 'admin' || user.role === 'agent'),
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.email}
                          </option>
                        ))}
                    </select>
                  </AP_FormField>
                ) : (
                  isAgent &&
                  booking.status === 'submitted' &&
                  !booking.assigneeId && (
                    <AP_Button
                      disabled={busyAction === booking.id}
                      onClick={() => onUpdate(booking, { assigneeId: 'self' })}
                    >
                      {text.adminAssignToMe}
                    </AP_Button>
                  )
                )}
                {booking.status === 'submitted' && (
                  <>
                    {booking.sessionStart && booking.sessionEnd ? (
                      <AP_Button
                        disabled={busyAction === booking.id}
                        onClick={() =>
                          onUpdate(booking, { status: 'confirmed' })
                        }
                      >
                        {text.adminConfirmBooking}
                      </AP_Button>
                    ) : (
                      <AP_Button
                        disabled={busyAction === booking.id}
                        onClick={() => onUpdate(booking, { status: 'handled' })}
                      >
                        {text.adminHandleBooking}
                      </AP_Button>
                    )}
                    {isAdmin && (
                      <AP_Button
                        variant="danger"
                        disabled={busyAction === booking.id}
                        onClick={() =>
                          onUpdate(booking, { status: 'cancelled' })
                        }
                      >
                        {text.adminCancelBooking}
                      </AP_Button>
                    )}
                  </>
                )}
              </div>
              {booking.status !== 'cancelled' && (
                <form
                  className="ap-admin-record__note-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const note = noteDrafts[booking.id]?.trim();
                    if (note) {
                      onUpdate(booking, { note });
                    }
                  }}
                >
                  <input
                    aria-label={`${text.adminAddNote}: ${booking.reference}`}
                    maxLength={1000}
                    placeholder={text.adminAddNote}
                    value={noteDrafts[booking.id] ?? ''}
                    onChange={(event) =>
                      setNoteDrafts((current) => ({
                        ...current,
                        [booking.id]: event.currentTarget.value,
                      }))
                    }
                  />
                  <AP_Button
                    type="submit"
                    disabled={
                      busyAction === booking.id ||
                      !noteDrafts[booking.id]?.trim()
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
