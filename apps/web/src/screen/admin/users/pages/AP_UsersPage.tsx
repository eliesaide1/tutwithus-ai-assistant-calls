import { useState, type FormEvent } from 'react';
import type { AdminManagedUser } from '@tutwithus/contracts/admin';
import { AdminUserCreateRequestSchema } from '@tutwithus/contracts/admin';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';

type AdminText = (typeof messages)['en'];

type AP_UsersPageProps = {
  text: AdminText;
  locale: Locale;
  isAdmin: boolean;
  currentUserEmail: string;
  users: AdminManagedUser[];
  email: string;
  password: string;
  role: AdminManagedUser['role'];
  loading: boolean;
  busyAction: string | null;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setRole: (value: AdminManagedUser['role']) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (
    user: AdminManagedUser,
    update: { role?: AdminManagedUser['role']; disabled?: boolean },
  ) => void;
  onDelete: (user: AdminManagedUser) => void;
};

export function AP_UsersPage({
  text,
  locale,
  isAdmin,
  currentUserEmail,
  users,
  email,
  password,
  role,
  loading,
  busyAction,
  setEmail,
  setPassword,
  setRole,
  onCreate,
  onUpdate,
  onDelete,
}: AP_UsersPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRoleHelp, setShowRoleHelp] = useState(false);

  return (
    <>
      <header className="ap-admin-operations__heading">
        <div>
          <h2>{text.adminUsers}</h2>
          <p>{text.adminUsersDescription}</p>
        </div>
      </header>
      {isAdmin && (
        <form className="ap-admin-user-form" onSubmit={onCreate}>
          <AP_FormField label={text.adminNewUserEmail}>
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </AP_FormField>
          <AP_FormField label={text.adminTemporaryPassword}>
            <div className="ap-admin-user-form__password">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <button
                aria-label={
                  showPassword ? text.adminHidePassword : text.adminShowPassword
                }
                aria-pressed={showPassword}
                className="ap-admin-user-form__visibility"
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                    <path
                      d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.7 4.5 9.5 6.1a1.8 1.8 0 0 1 0 1.8 13.4 13.4 0 0 1-3.1 3.7M6.2 6.3a14.2 14.2 0 0 0-3.7 4.8 1.8 1.8 0 0 0 0 1.8C3.3 14.5 6.8 19 12 19c.9 0 1.8-.1 2.6-.4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="2.7"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                  </svg>
                )}
              </button>
            </div>
          </AP_FormField>
          <div className="ap-admin-user-form__role">
            <div className="ap-admin-user-form__role-label">
              <label htmlFor="ap-admin-user-role">{text.adminUserRole}</label>
              <button
                aria-controls="ap-admin-role-help"
                aria-expanded={showRoleHelp}
                aria-label={text.adminRoleHelpButton}
                className="ap-admin-user-form__role-help-button"
                onClick={() => setShowRoleHelp((visible) => !visible)}
                type="button"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle
                    cx="10"
                    cy="10"
                    r="7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M8.2 7.5a1.85 1.85 0 1 1 3.2 1.25c-.7.72-1.4 1.05-1.4 2.15M10 13.8v.1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <select
              id="ap-admin-user-role"
              value={role}
              onChange={(event) => {
                const parsed =
                  AdminUserCreateRequestSchema.shape.role.safeParse(
                    event.currentTarget.value,
                  );
                if (parsed.success) {
                  setRole(parsed.data);
                }
              }}
            >
              <option value="admin">{text.adminRole}</option>
              <option value="editor">{text.adminRoleEditor}</option>
              <option value="agent">{text.adminRoleAgent}</option>
              <option value="viewer">{text.adminRoleViewer}</option>
            </select>
            <div
              aria-labelledby="ap-admin-role-help-title"
              className="ap-admin-user-form__role-help"
              hidden={!showRoleHelp}
              id="ap-admin-role-help"
              role="region"
            >
              <div className="ap-admin-user-form__role-help-heading">
                <h3 id="ap-admin-role-help-title">{text.adminRoleHelpTitle}</h3>
                <button
                  aria-label={text.adminRoleHelpClose}
                  className="ap-admin-user-form__role-help-close"
                  onClick={() => setShowRoleHelp(false)}
                  type="button"
                >
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="m5 5 10 10M15 5 5 15"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              <ul>
                <li>
                  <strong>{text.adminRole}</strong>
                  <span>{text.adminRoleHelpAdmin}</span>
                </li>
                <li>
                  <strong>{text.adminRoleEditor}</strong>
                  <span>{text.adminRoleHelpEditor}</span>
                </li>
                <li>
                  <strong>{text.adminRoleAgent}</strong>
                  <span>{text.adminRoleHelpAgent}</span>
                </li>
                <li>
                  <strong>{text.adminRoleViewer}</strong>
                  <span>{text.adminRoleHelpViewer}</span>
                </li>
              </ul>
            </div>
          </div>
          <AP_Button
            variant="primary"
            type="submit"
            disabled={busyAction === 'user-create'}
          >
            {text.adminCreateUserAction}
          </AP_Button>
        </form>
      )}
      {loading ? (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="section"
        />
      ) : users.length === 0 ? (
        <p className="ap-admin-operations__empty">{text.adminNoUsers}</p>
      ) : (
        <div className="ap-admin-table-wrap">
          <table className="ap-admin-table">
            <thead>
              <tr>
                <th scope="col">{text.adminNewUserEmail}</th>
                <th scope="col">{text.adminUserRole}</th>
                <th scope="col">{text.adminCreatedAt}</th>
                <th scope="col">{text.adminEnabled}</th>
                {isAdmin && <th scope="col">{text.adminAction}</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isCurrentUser = user.email === currentUserEmail;
                return (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>
                      {isAdmin && !isCurrentUser ? (
                        <select
                          aria-label={`${text.adminUserRole}: ${user.email}`}
                          value={user.role}
                          disabled={busyAction === user.id || isCurrentUser}
                          onChange={(event) => {
                            const parsed =
                              AdminUserCreateRequestSchema.shape.role.safeParse(
                                event.currentTarget.value,
                              );
                            if (parsed.success && parsed.data !== user.role) {
                              onUpdate(user, { role: parsed.data });
                            }
                          }}
                        >
                          <option value="admin">{text.adminRole}</option>
                          <option value="editor">{text.adminRoleEditor}</option>
                          <option value="agent">{text.adminRoleAgent}</option>
                          <option value="viewer">{text.adminRoleViewer}</option>
                        </select>
                      ) : user.role === 'admin' ? (
                        text.adminRole
                      ) : user.role === 'editor' ? (
                        text.adminRoleEditor
                      ) : user.role === 'agent' ? (
                        text.adminRoleAgent
                      ) : (
                        text.adminRoleViewer
                      )}
                    </td>
                    <td>
                      {new Date(user.createdAt).toLocaleDateString(locale)}
                    </td>
                    <td>
                      {user.disabled ? text.adminDisabled : text.adminEnabled}
                    </td>
                    {isAdmin && (
                      <td>
                        {!isCurrentUser && (
                          <div className="ap-admin-user-actions">
                            <AP_Button
                              className={`ap-admin-user-action ap-admin-user-action--toggle${user.disabled ? ' ap-admin-user-action--enable' : ' ap-admin-user-action--disable'}`}
                              type="button"
                              variant="secondary"
                              disabled={busyAction === user.id}
                              onClick={() =>
                                onUpdate(user, { disabled: !user.disabled })
                              }
                            >
                              {user.disabled
                                ? text.adminEnableUser
                                : text.adminDisableUser}
                            </AP_Button>
                            <AP_Button
                              className="ap-admin-user-action ap-admin-user-action--delete"
                              variant="danger"
                              type="button"
                              disabled={busyAction === user.id}
                              onClick={() => onDelete(user)}
                            >
                              {text.adminDeleteUser}
                            </AP_Button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
