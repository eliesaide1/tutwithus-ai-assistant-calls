import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BRAND_LOGO_SRC } from '../../../shared/brand.js';
import type {
  AgentSettings,
  AgentSettingsDraftRequest,
  AdminManagedUser,
  AuditLogEntry,
  BookingRequest,
  AdminConversation,
  AdminConversationSummary,
  Escalation,
  AdminAuthResponse,
  KnowledgeDocument,
} from '@tutwithus/contracts/admin';
import { AgentSettingsDraftRequestSchema } from '@tutwithus/contracts/admin';
import {
  AdminApiError,
  activateAgentSettings,
  adminLogout,
  createAdminUser,
  deleteAdminUser,
  deleteAgentSettingsDraft,
  deleteKnowledgeDocument,
  getAdminSettings,
  getAdminConversation,
  listAdminAudit,
  listAdminUsers,
  listAdminConversations,
  listBookingRequests,
  listEscalations,
  listKnowledgeDocuments,
  saveAgentSettingsDraft,
  updateAgentSettingsDraft,
  updateAdminUser,
  updateBookingRequest,
  updateEscalation,
  updateKnowledgeDocumentStatus,
  uploadKnowledgeDocument,
  saveKnowledgeEntry,
  isAdminSessionError,
  type AdminUiError,
} from '../admin-api.js';
import { AP_LanguageSwitch } from '../../../components/ui/AP_LanguageSwitch.js';
import { AP_LoadingIndicator } from '../../../components/ui/AP_LoadingIndicator.js';
import { getDirection, messages, type Locale } from '../../../shared/i18n.js';
import { AP_AdminOperationsPage } from '../pages/AP_AdminOperationsPage.js';
import { AP_KnowledgePage } from '../knowledge/pages/AP_KnowledgePage.js';
import { AP_ConversationsPage } from '../conversations/pages/AP_ConversationsPage.js';
import './AP_AdminDashboard.css';

type AP_AdminDashboardProps = {
  session: AdminAuthResponse;
  error: AdminUiError | null;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onSessionChange: (session: AdminAuthResponse | null) => void;
  onError: (error: AdminUiError | null) => void;
};

type AdminSection =
  | 'knowledge'
  | 'conversations'
  | 'bookings'
  | 'escalations'
  | 'settings'
  | 'users'
  | 'audit';

const ESCALATION_REFRESH_INTERVAL_MS = 15_000;

const sectionPaths: Record<AdminSection, string> = {
  knowledge: '/admin/knowledge',
  conversations: '/admin/conversations',
  bookings: '/admin/bookings',
  escalations: '/admin/escalations',
  settings: '/admin/settings',
  users: '/admin/users',
  audit: '/admin/audit',
};

function sectionFromPath(pathname: string): AdminSection | null {
  const normalizedPath = pathname.replace(/\/$/, '');
  const sections: AdminSection[] = [
    'knowledge',
    'conversations',
    'bookings',
    'escalations',
    'settings',
    'users',
    'audit',
  ];
  return (
    sections.find((candidate) => sectionPaths[candidate] === normalizedPath) ??
    null
  );
}

function AdminNavigationIcon({ section }: { section: AdminSection }) {
  return (
    <svg
      aria-hidden="true"
      className="ap-admin-sidebar__icon"
      viewBox="0 0 24 24"
    >
      {section === 'knowledge' ? (
        <>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" />
          <path d="M8 3v17M11 8h5M11 12h5" />
        </>
      ) : section === 'conversations' ? (
        <>
          <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" />
          <path d="M8 10h8M8 13.5h5" />
        </>
      ) : section === 'bookings' ? (
        <>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M4 9h16M8 13h3M8 17h3M14 13h2" />
        </>
      ) : section === 'escalations' ? (
        <>
          <path d="M12 3 22 20H2z" />
          <path d="M12 9v5M12 17.5h.01" />
        </>
      ) : section === 'settings' ? (
        <>
          <path d="m9.5 3-.6 2.2a7.6 7.6 0 0 0-1.6.9L5.1 5.3 3 9l1.8 1.4a7 7 0 0 0 0 1.9L3 13.7l2.1 3.7 2.2-.8a7.6 7.6 0 0 0 1.6.9l.6 2.2h4.2l.6-2.2a7.6 7.6 0 0 0 1.6-.9l2.2.8 2.1-3.7-1.8-1.4a7 7 0 0 0 0-1.9L20.2 9l-2.1-3.7-2.2.8a7.6 7.6 0 0 0-1.6-.9L13.7 3z" />
          <circle cx="11.6" cy="11.5" r="2.7" />
        </>
      ) : section === 'users' ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20v-1.5A5.5 5.5 0 0 1 9 13h1a5.5 5.5 0 0 1 5.5 5.5V20zM16 5.5a3 3 0 0 1 0 5.8M17 14h.5a4 4 0 0 1 4 4v2h-4" />
        </>
      ) : (
        <>
          <path d="M4 5h16M4 12h16M4 19h16" />
          <circle cx="8" cy="5" r="1" />
          <circle cx="14" cy="12" r="1" />
          <circle cx="10" cy="19" r="1" />
        </>
      )}
    </svg>
  );
}

const initialSettings: AgentSettingsDraftRequest = {
  name: 'New settings draft',
  greeting: {
    'ar-SA': 'مرحبًا، كيف يمكننا مساعدتك؟',
    en: 'Hello, how can we help you?',
    fr: 'Bonjour, comment pouvons-nous vous aider ?',
  },
  instructionTemplate:
    'You are the TutWithUs voice assistant. Answer from approved knowledge only. Do not invent details.',
  voice: 'marin',
  maxCallSec: 300,
  businessHours: 'Monday to Friday, 9:00 AM to 5:00 PM',
  escalation: {
    hoursText: 'A team member will follow up during business hours.',
  },
};

export function AP_AdminDashboard({
  session,
  error,
  locale,
  onLocaleChange,
  onSessionChange,
  onError,
}: AP_AdminDashboardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const defaultSection: AdminSection =
    session.user.role === 'admin' || session.user.role === 'editor'
      ? 'knowledge'
      : 'conversations';
  const requestedSection = sectionFromPath(location.pathname);
  const permittedSections: AdminSection[] =
    session.user.role === 'admin'
      ? [
          'knowledge',
          'conversations',
          'bookings',
          'escalations',
          'settings',
          'users',
          'audit',
        ]
      : session.user.role === 'editor'
        ? ['knowledge', 'conversations']
        : session.user.role === 'agent'
          ? ['conversations', 'bookings', 'escalations']
          : ['conversations'];
  const section =
    requestedSection && permittedSections.includes(requestedSection)
      ? requestedSection
      : defaultSection;
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<Locale>('en');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [conversations, setConversations] = useState<
    AdminConversationSummary[]
  >([]);
  const [conversationStatus, setConversationStatus] = useState<
    'all' | 'active' | 'ended'
  >('all');
  const [conversationLocale, setConversationLocale] = useState<'all' | Locale>(
    'all',
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [selectedConversation, setSelectedConversation] =
    useState<AdminConversation | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [bookingFilter, setBookingFilter] = useState<
    'all' | BookingRequest['status']
  >('all');
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [escalationFilter, setEscalationFilter] = useState<
    'all' | Escalation['status']
  >('all');
  const [escalationPriorityFilter, setEscalationPriorityFilter] = useState<
    'all' | Escalation['priority']
  >('all');
  const [settingsActive, setSettingsActive] = useState<AgentSettings | null>(
    null,
  );
  const [settingsDrafts, setSettingsDrafts] = useState<AgentSettings[]>([]);
  const [settingsDraft, setSettingsDraft] =
    useState<AgentSettingsDraftRequest>(initialSettings);
  const [settingsEditingVersion, setSettingsEditingVersion] = useState<
    number | null
  >(null);
  const settingsEditingVersionRef = useRef<number | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminManagedUser[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [loadingSection, setLoadingSection] = useState(
    section !== 'knowledge' && section !== 'conversations',
  );
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<AdminManagedUser['role']>('agent');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const text = messages[locale];
  const isAdmin = session.user.role === 'admin';
  const isAgent = session.user.role === 'agent';
  const canEditKnowledge = isAdmin || session.user.role === 'editor';
  const sectionTitles: Record<AdminSection, string> = {
    knowledge: text.adminKnowledgeBase,
    conversations: text.adminConversations,
    bookings: text.adminBookings,
    escalations: text.adminEscalations,
    settings: text.adminSettings,
    users: text.adminUsers,
    audit: text.adminAudit,
  };
  const pageTitle = sectionTitles[section];
  const sectionNavigation: Array<{
    id: AdminSection;
    label: string;
    roles: AdminManagedUser['role'][];
  }> = [
    {
      id: 'knowledge',
      label: text.adminKnowledgeBase,
      roles: ['admin', 'editor'],
    },
    {
      id: 'conversations',
      label: text.adminConversations,
      roles: ['admin', 'agent', 'viewer'],
    },
    {
      id: 'bookings',
      label: text.adminBookings,
      roles: ['admin', 'agent'],
    },
    {
      id: 'escalations',
      label: text.adminEscalations,
      roles: ['admin', 'agent'],
    },
    { id: 'settings', label: text.adminSettings, roles: ['admin'] },
    { id: 'users', label: text.adminUsers, roles: ['admin'] },
    { id: 'audit', label: text.adminAudit, roles: ['admin'] },
  ];
  const direction = getDirection(locale);
  const languageOptions: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: text.languageEnglish },
    { value: 'ar-SA', label: text.languageArabic },
    { value: 'fr', label: text.languageFrench },
  ];

  useEffect(() => {
    const target = sectionPaths[section];
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [location.pathname, navigate, section]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (session.user.role !== 'admin' && session.user.role !== 'editor') {
      return;
    }
    let active = true;
    void listKnowledgeDocuments()
      .then((items) => {
        if (active) {
          setDocuments(items);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          onError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'request' },
          );
          if (isAdminSessionError(cause)) {
            onSessionChange(null);
          }
        }
      })
      .finally(() => {
        if (active) {
          setLoadingDocuments(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onError, onSessionChange, session.user.role]);

  useEffect(() => {
    if (section !== 'conversations') {
      return;
    }

    let active = true;
    onError(null);
    void listAdminConversations({
      ...(conversationStatus === 'all' ? {} : { status: conversationStatus }),
      ...(conversationLocale === 'all' ? {} : { locale: conversationLocale }),
    })
      .then((items) => {
        if (active) {
          setConversations(items);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          onError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'request' },
          );
          if (isAdminSessionError(cause)) {
            onSessionChange(null);
          }
        }
      })
      .finally(() => {
        if (active) {
          setLoadingConversations(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    conversationLocale,
    conversationStatus,
    onError,
    onSessionChange,
    section,
  ]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    let active = true;
    void getAdminConversation(selectedConversationId)
      .then((conversation) => {
        if (active) {
          setSelectedConversation(conversation);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          onError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'request' },
          );
          if (isAdminSessionError(cause)) {
            onSessionChange(null);
          }
        }
      })
      .finally(() => {
        if (active) {
          setLoadingConversation(false);
        }
      });

    return () => {
      active = false;
    };
  }, [onError, onSessionChange, selectedConversationId]);

  useEffect(() => {
    let active = true;
    async function loadSection() {
      try {
        switch (section) {
          case 'bookings': {
            const [items, users] = await Promise.all([
              listBookingRequests(
                bookingFilter === 'all' ? undefined : bookingFilter,
              ),
              isAdmin ? listAdminUsers() : Promise.resolve([]),
            ]);
            if (active) {
              setBookings(items);
              if (isAdmin) {
                setAdminUsers(users);
              }
            }
            break;
          }
          case 'escalations': {
            const items = await listEscalations();
            if (active) {
              setEscalations(items);
            }
            break;
          }
          case 'settings': {
            const settings = await getAdminSettings();
            if (active) {
              setSettingsActive(settings.active);
              setSettingsDrafts(settings.drafts);
              if (
                settings.active &&
                settingsEditingVersionRef.current === null
              ) {
                const {
                  version: _version,
                  status: _status,
                  activatedBy: _activatedBy,
                  activatedAt: _activatedAt,
                  createdAt: _createdAt,
                  updatedAt: _updatedAt,
                  ...draft
                } = settings.active;
                setSettingsDraft(
                  AgentSettingsDraftRequestSchema.parse({
                    ...draft,
                    name: draft.name ?? initialSettings.name,
                  }),
                );
              }
            }
            break;
          }
          case 'users': {
            const users = await listAdminUsers();
            if (active) {
              setAdminUsers(users);
            }
            break;
          }
          case 'audit': {
            const [entries, users] = await Promise.all([
              listAdminAudit({ limit: 100 }),
              listAdminUsers(),
            ]);
            if (active) {
              setAuditEntries(entries);
              setAdminUsers(users);
            }
            break;
          }
        }
      } catch (cause) {
        if (active) {
          onError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'request' },
          );
          if (isAdminSessionError(cause)) {
            onSessionChange(null);
          }
        }
      } finally {
        if (active) {
          setLoadingSection(false);
        }
      }
    }

    if (
      section === 'bookings' ||
      section === 'escalations' ||
      section === 'settings' ||
      section === 'users' ||
      section === 'audit'
    ) {
      void loadSection();
    }
    return () => {
      active = false;
    };
  }, [bookingFilter, isAdmin, onError, onSessionChange, section]);

  useEffect(() => {
    if (section !== 'escalations') {
      return;
    }

    let active = true;
    let refreshing = false;
    const refreshEscalations = async () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      try {
        const items = await listEscalations();
        if (active) {
          setEscalations(items);
        }
      } catch (cause) {
        if (active) {
          onError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'request' },
          );
          if (isAdminSessionError(cause)) {
            onSessionChange(null);
          }
        }
      } finally {
        refreshing = false;
      }
    };
    const intervalId = window.setInterval(
      () => void refreshEscalations(),
      ESCALATION_REFRESH_INTERVAL_MS,
    );
    window.addEventListener('focus', refreshEscalations);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshEscalations);
    };
  }, [onError, onSessionChange, section]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) {
      setNotice(text.adminChooseDocument);
      return;
    }

    setUploading(true);
    setNotice('');
    onError(null);
    try {
      const document = await uploadKnowledgeDocument(
        file,
        language,
        session.csrfToken,
      );
      setDocuments((current) => [
        document,
        ...current.filter((item) => item.sourceId !== document.sourceId),
      ]);
      setFile(null);
      form.reset();
      setNotice(
        text.adminIndexedSuccess.replace('{name}', document.originalName),
      );
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(document: KnowledgeDocument) {
    onError(null);
    setNotice('');
    try {
      await deleteKnowledgeDocument(document.sourceId, session.csrfToken);
      setDocuments((current) =>
        current.filter((item) => item.sourceId !== document.sourceId),
      );
      setNotice(
        text.adminRemovedSuccess.replace('{name}', document.originalName),
      );
    } catch (cause) {
      reportMutationError(cause);
    }
  }

  async function changeDocumentStatus(
    document: KnowledgeDocument,
    status: 'in_review' | 'draft' | 'approved' | 'published' | 'archived',
  ) {
    onError(null);
    setNotice('');
    try {
      await updateKnowledgeDocumentStatus(
        document.sourceId,
        status,
        session.csrfToken,
      );
      setDocuments((current) =>
        current.map((item) =>
          item.sourceId === document.sourceId ? { ...item, status } : item,
        ),
      );
    } catch (cause) {
      reportMutationError(cause);
    }
  }

  function getRoleLabel() {
    switch (session.user.role) {
      case 'admin':
        return text.adminRole;
      case 'editor':
        return text.adminRoleEditor;
      case 'agent':
        return text.adminRoleAgent;
      case 'viewer':
        return text.adminRoleViewer;
    }
  }

  function reportMutationError(cause: unknown) {
    onError(
      cause instanceof AdminApiError
        ? { type: 'message', message: cause.message }
        : { type: 'request' },
    );
  }

  async function mutateBooking(
    booking: BookingRequest,
    update: {
      status?: BookingRequest['status'];
      assigneeId?: string | null;
      note?: string;
    },
  ) {
    setBusyAction(booking.id);
    onError(null);
    try {
      await updateBookingRequest(booking.id, update, session.csrfToken);
      setBookings(
        await listBookingRequests(
          bookingFilter === 'all' ? undefined : bookingFilter,
        ),
      );
      setNoteDrafts((current) => ({ ...current, [booking.id]: '' }));
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function mutateEscalation(
    escalation: Escalation,
    update: { action?: 'claim' | 'resolve' | 'reopen'; note?: string },
  ) {
    setBusyAction(escalation.id);
    onError(null);
    try {
      await updateEscalation(escalation.id, update, session.csrfToken);
      setEscalations(await listEscalations());
      setNoteDrafts((current) => ({ ...current, [escalation.id]: '' }));
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  function updateSettingsDraft<K extends keyof AgentSettingsDraftRequest>(
    key: K,
    value: AgentSettingsDraftRequest[K],
  ) {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setBusyAction('settings-save');
    onError(null);
    setNotice('');
    try {
      const saved =
        settingsEditingVersion === null
          ? await saveAgentSettingsDraft(settingsDraft, session.csrfToken)
          : await updateAgentSettingsDraft(
              settingsEditingVersion,
              settingsDraft,
              session.csrfToken,
            );
      setSettingsDrafts((current) =>
        [
          saved,
          ...current.filter((item) => item.version !== saved.version),
        ].sort((left, right) => right.version - left.version),
      );
      if (settingsEditingVersion === null) {
        settingsEditingVersionRef.current = saved.version;
        setSettingsEditingVersion(saved.version);
      }
      setNotice(
        settingsEditingVersion === null
          ? text.adminSettingsSaved.replace('{version}', `${saved.version}`)
          : text.adminSettingsUpdated.replace('{name}', saved.name ?? ''),
      );
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  function editSettingsDraft(version: AgentSettings) {
    const {
      version: _version,
      status: _status,
      activatedBy: _activatedBy,
      activatedAt: _activatedAt,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...draft
    } = version;
    const parsedDraft = AgentSettingsDraftRequestSchema.parse(draft);
    const editingSavedDraft = version.status === 'draft';
    settingsEditingVersionRef.current = editingSavedDraft
      ? version.version
      : null;
    setSettingsEditingVersion(editingSavedDraft ? version.version : null);
    setNotice('');
    setSettingsDraft(parsedDraft);
    onError(null);
  }

  function startNewSettingsDraft() {
    settingsEditingVersionRef.current = null;
    setSettingsEditingVersion(null);
    const source = settingsActive ?? initialSettings;
    setSettingsDraft(
      AgentSettingsDraftRequestSchema.parse({
        ...source,
        name: initialSettings.name,
        greeting: { ...source.greeting },
        escalation: { ...source.escalation },
      }),
    );
    setNotice('');
    onError(null);
  }

  async function removeSettingsDraft(version: AgentSettings) {
    if (
      !window.confirm(
        text.adminConfirmDeleteVersion.replace(
          '{name}',
          version.name ?? `v${version.version}`,
        ),
      )
    ) {
      return;
    }

    setBusyAction(`settings-delete-${version.version}`);
    onError(null);
    setNotice('');
    try {
      await deleteAgentSettingsDraft(version.version, session.csrfToken);
      setSettingsActive((current) =>
        current?.version === version.version ? null : current,
      );
      setSettingsDrafts((current) =>
        current.filter((item) => item.version !== version.version),
      );
      if (settingsEditingVersion === version.version) {
        startNewSettingsDraft();
      }
      setNotice(
        text.adminSettingsDeleted.replace(
          '{name}',
          version.name ?? `v${version.version}`,
        ),
      );
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function activateSettings(version: number) {
    setBusyAction(`settings-${version}`);
    onError(null);
    setNotice('');
    try {
      await activateAgentSettings(version, session.csrfToken);
      const current = await getAdminSettings();
      setSettingsActive(current.active);
      setSettingsDrafts(current.drafts);
      setNotice(text.adminSettingsActivated.replace('{version}', `${version}`));
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction('user-create');
    onError(null);
    setNotice('');
    try {
      await createAdminUser(
        { email: userEmail, password: userPassword, role: userRole },
        session.csrfToken,
      );
      setAdminUsers(await listAdminUsers());
      setUserEmail('');
      setUserPassword('');
      setNotice(text.adminUserCreated);
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function changeUser(
    user: AdminManagedUser,
    update: { role?: AdminManagedUser['role']; disabled?: boolean },
  ) {
    setBusyAction(user.id);
    onError(null);
    try {
      const updated = await updateAdminUser(user.id, update, session.csrfToken);
      setAdminUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function removeUser(user: AdminManagedUser) {
    if (
      !isAdmin ||
      user.email === session.user.email ||
      !window.confirm(
        text.adminConfirmDeleteUser.replace('{email}', user.email),
      )
    ) {
      return;
    }

    setBusyAction(user.id);
    onError(null);
    setNotice('');
    try {
      await deleteAdminUser(user.id, session.csrfToken);
      setAdminUsers((current) => current.filter((item) => item.id !== user.id));
      setNotice(text.adminUserDeleted.replace('{email}', user.email));
    } catch (cause) {
      reportMutationError(cause);
    } finally {
      setBusyAction(null);
    }
  }

  async function signOut() {
    onError(null);
    try {
      await adminLogout(session.csrfToken);
      onSessionChange(null);
      navigate('/admin/login', { replace: true });
    } catch (cause) {
      onError(
        cause instanceof AdminApiError
          ? { type: 'message', message: cause.message }
          : { type: 'request' },
      );
    }
  }

  return (
    <div
      className={`ap-admin-shell${section === 'conversations' ? ' ap-admin-shell--conversations' : ''}${sidebarCollapsed ? ' ap-admin-shell--sidebar-collapsed' : ''}`}
      dir={direction}
      lang={locale}
    >
      {(busyAction !== null || uploading) && (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="overlay"
        />
      )}
      {menuOpen && (
        <button
          aria-label={text.adminCloseMenu}
          className="ap-admin-sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      )}
      <aside
        id="admin-navigation"
        className={`ap-admin-sidebar${menuOpen ? ' ap-admin-sidebar--open' : ''}`}
      >
        <img
          src={BRAND_LOGO_SRC}
          alt={text.brandName}
          className="ap-admin-sidebar__brand"
        />
        <div className="ap-admin-sidebar__heading">
          <p className="ap-admin-sidebar__caption">{text.adminWorkspace}</p>
          <button
            aria-label={
              sidebarCollapsed
                ? text.adminExpandSidebar
                : text.adminCollapseSidebar
            }
            aria-controls="admin-navigation"
            aria-expanded={!sidebarCollapsed}
            className="ap-admin-sidebar__toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={
              sidebarCollapsed
                ? text.adminExpandSidebar
                : text.adminCollapseSidebar
            }
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
              <path d={sidebarCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
            </svg>
          </button>
          <button
            aria-label={text.adminCloseMenu}
            className="ap-admin-sidebar__close"
            onClick={() => setMenuOpen(false)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <nav aria-label={text.adminWorkspace}>
          {sectionNavigation
            .filter((item) => item.roles.includes(session.user.role))
            .map((item) => (
              <button
                className={`ap-admin-sidebar__link${section === item.id ? ' ap-admin-sidebar__link--active' : ''}`}
                key={item.id}
                onClick={() => {
                  if (item.id === 'conversations' && section !== item.id) {
                    setLoadingConversations(true);
                  }
                  if (
                    item.id === 'bookings' ||
                    item.id === 'escalations' ||
                    item.id === 'settings' ||
                    item.id === 'users' ||
                    item.id === 'audit'
                  ) {
                    setLoadingSection(true);
                  }
                  navigate(sectionPaths[item.id]);
                  setMenuOpen(false);
                }}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                aria-label={sidebarCollapsed ? item.label : undefined}
              >
                <span aria-hidden="true">
                  <AdminNavigationIcon section={item.id} />
                </span>
                <span className="ap-admin-sidebar__link-label">
                  {item.label}
                </span>
              </button>
            ))}
        </nav>
        <div className="ap-admin-sidebar__footer">
          <div className="ap-admin-sidebar__user">
            <span className="ap-admin-sidebar__avatar" aria-hidden="true">
              {session.user.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="ap-admin-sidebar__identity">
              <strong>{session.user.email}</strong>
              <small>{getRoleLabel()}</small>
            </span>
          </div>
          <button
            aria-label={text.adminSignOut}
            className="ap-admin-sidebar__signout"
            type="button"
            onClick={() => void signOut()}
          >
            <span className="ap-admin-sidebar__signout-label">
              {text.adminSignOut}
            </span>
            <span aria-hidden="true" className="ap-admin-sidebar__signout-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
              </svg>
            </span>
          </button>
        </div>
      </aside>

      <main
        className={`ap-admin-main${section === 'conversations' ? ' ap-admin-main--conversations' : ''}`}
      >
        <header className="ap-admin-topbar">
          <div className="ap-admin-topbar__heading">
            <img
              src={BRAND_LOGO_SRC}
              alt={text.brandName}
              className="ap-admin-topbar__logo"
            />
            <div className="ap-admin-topbar__title">
              <p className="ap-admin-topbar__eyebrow">{text.adminWorkspace}</p>
              <h1>{pageTitle}</h1>
            </div>
          </div>
          <div className="ap-admin-topbar__actions">
            <AP_LanguageSwitch
              compact
              languageNames={{
                'ar-SA': text.languageArabic,
                en: text.languageEnglish,
                fr: text.languageFrench,
              }}
              label={text.languagePickerLabel}
              locale={locale}
              onLocaleChange={onLocaleChange}
            />
            <button
              aria-controls="admin-navigation"
              aria-expanded={menuOpen}
              aria-label={text.adminOpenMenu}
              className="ap-admin-topbar__menu"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </header>

        <div className="ap-admin-feedback" aria-live="polite">
          {error && (
            <p className="ap-admin-feedback__error" role="alert">
              {error.type === 'message'
                ? error.message
                : error.type === 'session'
                  ? text.adminSessionError
                  : text.adminRequestError}
            </p>
          )}
          {notice && <p className="ap-admin-feedback__success">{notice}</p>}
        </div>

        {section === 'knowledge' ? (
          <AP_KnowledgePage
            text={text}
            locale={locale}
            isAdmin={isAdmin}
            canEdit={canEditKnowledge}
            documents={documents}
            onSaveEntry={async (entry, edit) => {
              const saved = await saveKnowledgeEntry(
                entry,
                session.csrfToken,
                edit,
              );
              setDocuments((current) => [
                saved,
                ...current.filter((item) => item.sourceId !== saved.sourceId),
              ]);
            }}
            loading={loadingDocuments}
            file={file}
            language={language}
            uploading={uploading}
            languageOptions={languageOptions}
            onFileChange={setFile}
            onLanguageChange={setLanguage}
            onUpload={(event) => void submitUpload(event)}
            onRemove={(document) => void removeDocument(document)}
            onStatusChange={(document, status) =>
              void changeDocumentStatus(document, status)
            }
          />
        ) : section === 'conversations' ? (
          <AP_ConversationsPage
            text={text}
            locale={locale}
            conversations={conversations}
            status={conversationStatus}
            conversationLocale={conversationLocale}
            selectedId={selectedConversationId}
            selectedConversation={selectedConversation}
            loading={loadingConversations}
            loadingDetail={loadingConversation}
            languageOptions={languageOptions}
            onStatusChange={(status) => {
              if (status !== conversationStatus) {
                setConversationStatus(status);
                setSelectedConversationId(null);
                setSelectedConversation(null);
                setLoadingConversations(true);
              }
            }}
            onLocaleChange={(nextLocale) => {
              if (nextLocale !== conversationLocale) {
                setConversationLocale(nextLocale);
                setSelectedConversationId(null);
                setSelectedConversation(null);
                setLoadingConversations(true);
              }
            }}
            onSelect={(sessionId) => {
              if (selectedConversationId !== sessionId) {
                setSelectedConversation(null);
                setLoadingConversation(true);
                setSelectedConversationId(sessionId);
              }
            }}
            onBack={() => {
              setSelectedConversationId(null);
              setSelectedConversation(null);
              setLoadingConversation(false);
            }}
          />
        ) : (
          <AP_AdminOperationsPage
            section={section}
            text={text}
            locale={locale}
            session={session}
            isAdmin={isAdmin}
            isAgent={isAgent}
            bookings={bookings}
            bookingFilter={bookingFilter}
            escalations={escalations}
            escalationFilter={escalationFilter}
            escalationPriorityFilter={escalationPriorityFilter}
            settingsActive={settingsActive}
            settingsDrafts={settingsDrafts}
            settingsDraft={settingsDraft}
            settingsEditingVersion={settingsEditingVersion}
            adminUsers={adminUsers}
            auditEntries={auditEntries}
            languageOptions={languageOptions}
            userEmail={userEmail}
            userPassword={userPassword}
            userRole={userRole}
            loading={loadingSection}
            busyAction={busyAction}
            noteDrafts={noteDrafts}
            setBookingFilter={(filter) => {
              setBookingFilter(filter);
              setLoadingSection(true);
            }}
            setEscalationFilter={(filter) => {
              setEscalationFilter(filter);
            }}
            setEscalationPriorityFilter={(filter) => {
              setEscalationPriorityFilter(filter);
            }}
            setNoteDrafts={setNoteDrafts}
            setUserEmail={setUserEmail}
            setUserPassword={setUserPassword}
            setUserRole={setUserRole}
            onBookingUpdate={mutateBooking}
            onEscalationUpdate={mutateEscalation}
            onSettingsDraftChange={updateSettingsDraft}
            onSettingsNew={startNewSettingsDraft}
            onSettingsEdit={editSettingsDraft}
            onSettingsDelete={(version) => void removeSettingsDraft(version)}
            onGreetingChange={(greetingLocale, greeting) =>
              setSettingsDraft((current) => ({
                ...current,
                greeting: { ...current.greeting, [greetingLocale]: greeting },
              }))
            }
            onEscalationSettingsChange={(value) =>
              setSettingsDraft((current) => ({
                ...current,
                escalation: { ...current.escalation, hoursText: value },
              }))
            }
            onSaveSettings={saveSettings}
            onActivateSettings={activateSettings}
            onAddUser={addUser}
            onChangeUser={changeUser}
            onDeleteUser={(user) => void removeUser(user)}
          />
        )}
      </main>
    </div>
  );
}
