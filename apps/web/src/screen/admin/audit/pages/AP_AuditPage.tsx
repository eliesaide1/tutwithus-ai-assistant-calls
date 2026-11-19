import type {
  AuditLogEntry,
  AdminManagedUser,
} from '@tutwithus/contracts/admin';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';

type AdminText = (typeof messages)['en'];

type AP_AuditPageProps = {
  text: AdminText;
  locale: Locale;
  entries: AuditLogEntry[];
  users: AdminManagedUser[];
  loading: boolean;
};

export function AP_AuditPage({
  text,
  locale,
  entries,
  users,
  loading,
}: AP_AuditPageProps) {
  return (
    <>
      <header className="ap-admin-operations__heading">
        <div>
          <h2>{text.adminAudit}</h2>
          <p>{text.adminAuditDescription}</p>
        </div>
      </header>
      {loading ? (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="section"
        />
      ) : entries.length === 0 ? (
        <p className="ap-admin-operations__empty">{text.adminNoAudit}</p>
      ) : (
        <div className="ap-admin-table-wrap">
          <table className="ap-admin-table">
            <thead>
              <tr>
                <th scope="col">{text.adminWhen}</th>
                <th scope="col">{text.adminActor}</th>
                <th scope="col">{text.adminAction}</th>
                <th scope="col">{text.adminEntity}</th>
                <th scope="col">{text.adminEntityId}</th>
                <th scope="col">{text.adminChangeDetails}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.at).toLocaleString(locale)}</td>
                  <td>
                    {users.find((user) => user.id === entry.actorId)?.email ??
                      entry.actorId}
                  </td>
                  <td>{entry.action}</td>
                  <td>{entry.entity}</td>
                  <td>{entry.entityId}</td>
                  <td>
                    <code>{JSON.stringify(entry.diff)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
