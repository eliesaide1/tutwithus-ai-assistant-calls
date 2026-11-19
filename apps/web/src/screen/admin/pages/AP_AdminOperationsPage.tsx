import type { FormEvent, Dispatch, SetStateAction } from 'react';
import type {
  AgentSettings,
  AgentSettingsDraftRequest,
  AdminManagedUser,
  AuditLogEntry,
  BookingRequest,
  Escalation,
  AdminAuthResponse,
} from '@tutwithus/contracts/admin';
import type { Locale, messages } from '../../../shared/i18n.js';
import { AP_AuditPage } from '../audit/pages/AP_AuditPage.js';
import { AP_BookingRequestsPage } from '../bookings/pages/AP_BookingRequestsPage.js';
import { AP_EscalationsPage } from '../escalations/pages/AP_EscalationsPage.js';
import { AP_SettingsPage } from '../settings/pages/AP_SettingsPage.js';
import { AP_UsersPage } from '../users/pages/AP_UsersPage.js';

type AdminText = (typeof messages)['en'];
type AdminSection = 'bookings' | 'escalations' | 'settings' | 'users' | 'audit';
type BookingUpdate = {
  status?: BookingRequest['status'];
  assigneeId?: string | null;
  note?: string;
};
type EscalationUpdate = {
  action?: 'claim' | 'resolve' | 'reopen';
  note?: string;
};

type AP_AdminOperationsPageProps = {
  section: AdminSection;
  text: AdminText;
  locale: Locale;
  session: AdminAuthResponse;
  isAdmin: boolean;
  isAgent: boolean;
  bookings: BookingRequest[];
  bookingFilter: 'all' | BookingRequest['status'];
  escalations: Escalation[];
  escalationFilter: 'all' | Escalation['status'];
  escalationPriorityFilter: 'all' | Escalation['priority'];
  settingsActive: AgentSettings | null;
  settingsDrafts: AgentSettings[];
  settingsDraft: AgentSettingsDraftRequest;
  settingsEditingVersion: number | null;
  adminUsers: AdminManagedUser[];
  auditEntries: AuditLogEntry[];
  languageOptions: Array<{ value: Locale; label: string }>;
  userEmail: string;
  userPassword: string;
  userRole: AdminManagedUser['role'];
  loading: boolean;
  busyAction: string | null;
  noteDrafts: Record<string, string>;
  setBookingFilter: (filter: 'all' | BookingRequest['status']) => void;
  setEscalationFilter: (filter: 'all' | Escalation['status']) => void;
  setEscalationPriorityFilter: (filter: 'all' | Escalation['priority']) => void;
  setNoteDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setUserEmail: (value: string) => void;
  setUserPassword: (value: string) => void;
  setUserRole: (value: AdminManagedUser['role']) => void;
  onBookingUpdate: (booking: BookingRequest, update: BookingUpdate) => void;
  onEscalationUpdate: (
    escalation: Escalation,
    update: EscalationUpdate,
  ) => void;
  onSettingsDraftChange: <K extends keyof AgentSettingsDraftRequest>(
    key: K,
    value: AgentSettingsDraftRequest[K],
  ) => void;
  onSettingsNew: () => void;
  onSettingsEdit: (version: AgentSettings) => void;
  onSettingsDelete: (version: AgentSettings) => void;
  onGreetingChange: (locale: Locale, greeting: string) => void;
  onEscalationSettingsChange: (value: string) => void;
  onSaveSettings: () => void;
  onActivateSettings: (version: number) => void;
  onAddUser: (event: FormEvent<HTMLFormElement>) => void;
  onChangeUser: (
    user: AdminManagedUser,
    update: { role?: AdminManagedUser['role']; disabled?: boolean },
  ) => void;
  onDeleteUser: (user: AdminManagedUser) => void;
};

export function AP_AdminOperationsPage({
  section,
  text,
  locale,
  session,
  isAdmin,
  isAgent,
  bookings,
  bookingFilter,
  escalations,
  escalationFilter,
  escalationPriorityFilter,
  settingsActive,
  settingsDrafts,
  settingsDraft,
  settingsEditingVersion,
  adminUsers,
  auditEntries,
  languageOptions,
  userEmail,
  userPassword,
  userRole,
  loading,
  busyAction,
  noteDrafts,
  setBookingFilter,
  setEscalationFilter,
  setEscalationPriorityFilter,
  setNoteDrafts,
  setUserEmail,
  setUserPassword,
  setUserRole,
  onBookingUpdate,
  onEscalationUpdate,
  onSettingsDraftChange,
  onSettingsNew,
  onSettingsEdit,
  onSettingsDelete,
  onGreetingChange,
  onEscalationSettingsChange,
  onSaveSettings,
  onActivateSettings,
  onAddUser,
  onChangeUser,
  onDeleteUser,
}: AP_AdminOperationsPageProps) {
  return (
    <section className="ap-admin-operations">
      {section === 'bookings' && (
        <AP_BookingRequestsPage
          text={text}
          locale={locale}
          isAdmin={isAdmin}
          isAgent={isAgent}
          bookings={bookings}
          users={adminUsers}
          filter={bookingFilter}
          loading={loading}
          busyAction={busyAction}
          noteDrafts={noteDrafts}
          setFilter={(filter) => {
            setBookingFilter(filter);
          }}
          setNoteDrafts={setNoteDrafts}
          onUpdate={onBookingUpdate}
        />
      )}
      {section === 'escalations' && (
        <AP_EscalationsPage
          text={text}
          locale={locale}
          isAdmin={isAdmin}
          escalations={escalations}
          filter={escalationFilter}
          priorityFilter={escalationPriorityFilter}
          loading={loading}
          busyAction={busyAction}
          noteDrafts={noteDrafts}
          setFilter={setEscalationFilter}
          setPriorityFilter={setEscalationPriorityFilter}
          setNoteDrafts={setNoteDrafts}
          onUpdate={onEscalationUpdate}
        />
      )}
      {section === 'settings' && (
        <AP_SettingsPage
          text={text}
          settingsActive={settingsActive}
          settingsDrafts={settingsDrafts}
          settingsDraft={settingsDraft}
          settingsEditingVersion={settingsEditingVersion}
          languageOptions={languageOptions}
          loading={loading}
          busyAction={busyAction}
          onDraftChange={onSettingsDraftChange}
          onNew={onSettingsNew}
          onEdit={onSettingsEdit}
          onDelete={onSettingsDelete}
          onGreetingChange={onGreetingChange}
          onEscalationChange={onEscalationSettingsChange}
          onSave={onSaveSettings}
          onActivate={onActivateSettings}
        />
      )}
      {section === 'users' && (
        <AP_UsersPage
          text={text}
          locale={locale}
          isAdmin={isAdmin}
          currentUserEmail={session.user.email}
          users={adminUsers}
          email={userEmail}
          password={userPassword}
          role={userRole}
          loading={loading}
          busyAction={busyAction}
          setEmail={setUserEmail}
          setPassword={setUserPassword}
          setRole={setUserRole}
          onCreate={onAddUser}
          onUpdate={onChangeUser}
          onDelete={onDeleteUser}
        />
      )}
      {section === 'audit' && (
        <AP_AuditPage
          text={text}
          locale={locale}
          entries={auditEntries}
          users={adminUsers}
          loading={loading}
        />
      )}
    </section>
  );
}
