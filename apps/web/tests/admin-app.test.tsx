import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AP_AdminApp } from '../src/screen/admin/AP_AdminApp.js';
import { listKnowledgeDocuments } from '../src/screen/admin/admin-api.js';
import {
  resetApiClientAdapter,
  useFetchBackedApiClient,
} from './api-client-test-utils.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAdminApp() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AP_AdminApp />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetApiClientAdapter();
});

describe('admin workspace', () => {
  beforeEach(() => {
    useFetchBackedApiClient();
  });

  it('opens and closes the mobile navigation menu with buttons and Escape', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            user: { email: 'admin@example.com', role: 'admin' },
            csrfToken: 'c'.repeat(43),
          }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { documents: [] })),
    );

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base' });

    expect(
      screen.queryByRole('heading', {
        name: 'Give your assistant trusted information',
      }),
    ).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Sign out' })
        .closest('.ap-admin-sidebar__footer'),
    ).toBeTruthy();

    const collapseButton = screen.getByRole('button', {
      name: 'Collapse sidebar',
    });
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapseButton);
    expect(
      screen
        .getByRole('button', { name: 'Expand sidebar' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Knowledge base' })
        .getAttribute('title'),
    ).toBe('Knowledge base');
    expect(
      screen
        .getByRole('button', { name: 'Sign out' })
        .getAttribute('aria-label'),
    ).toBe('Sign out');
    expect(
      screen
        .getByRole('button', { name: 'Knowledge base' })
        .querySelector('svg'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    const menuButton = screen.getByRole('button', {
      name: 'Open navigation menu',
    });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeTruthy();

    const closeButtons = screen.getAllByRole('button', {
      name: 'Close navigation menu',
    });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(menuButton);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('explains non-JSON API failures with their HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    await expect(listKnowledgeDocuments()).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 502,
      message: expect.stringContaining(
        'The server returned HTTP 502 without a valid JSON error.',
      ),
    });
  });

  it('signs in without returning a JWT to browser storage and opens the knowledge shell', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { message: 'Login required.' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { documents: [] }));
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    const emailInput = await screen.findByLabelText('Email address');
    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(emailInput, {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'correct-horse-battery-staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'French' }));
    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Ravi de vous revoir' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Arabe' }));
    expect(screen.getByLabelText('البريد الإلكتروني')).toBeTruthy();
    expect(document.querySelector('main')?.getAttribute('dir')).toBe('rtl');
    fireEvent.click(screen.getByRole('button', { name: 'الإنجليزية' }));

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in to workspace' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Knowledge base' }),
    ).toBeTruthy();
    expect(screen.getByText('admin@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Arabic' }));
    expect(screen.getByRole('heading', { name: 'قاعدة المعرفة' })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).not.toContain('token');
    expect(screen.getByTestId('current-path').textContent).toBe(
      '/admin/knowledge',
    );
  });

  it('returns to the login route after a successful sidebar sign-out', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { documents: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { status: 'logged_out' }));
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('current-path').textContent).toBe(
        '/admin/login',
      );
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/admin/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens the role-protected booking, escalation, settings, users, and audit pages', async () => {
    let resolveUsersResponse: ((response: Response) => void) | undefined;
    let usersRequestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/booking-requests')) {
        return jsonResponse(200, { bookings: [] });
      }
      if (url.endsWith('/users')) {
        usersRequestCount += 1;
        if (usersRequestCount !== 2) {
          return jsonResponse(200, { users: [] });
        }
        return await new Promise<Response>((resolve) => {
          resolveUsersResponse = resolve;
        });
      }
      if (url.endsWith('/escalations')) {
        return jsonResponse(200, { escalations: [] });
      }
      if (url.endsWith('/settings')) {
        return jsonResponse(200, { active: null, drafts: [] });
      }
      if (url.endsWith('/audit?limit=100')) {
        return jsonResponse(200, { entries: [] });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }));
    expect(
      await screen.findByText('No booking requests match this view.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Escalations' }));
    expect(
      await screen.findByText('No escalations match this view.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Priority')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }));
    expect(await screen.findByLabelText('Greeting · English')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    const loadingIndicator = await screen.findByRole('status', {
      name: 'Loading records…',
    });
    expect(loadingIndicator.textContent).toBe('');
    expect(
      loadingIndicator.querySelectorAll('.ap-loading-indicator__dots > span'),
    ).toHaveLength(3);
    resolveUsersResponse?.(jsonResponse(200, { users: [] }));
    expect(await screen.findByText('No users have been added.')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show role permissions' }),
    );
    expect(
      screen.getByRole('region', { name: 'Role permissions' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Manage knowledge documents and submit them for administrator review. No access to other workspace areas.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'View conversations and manage bookings and escalations. Contact details remain restricted.',
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Close role permissions' }),
    );
    expect(
      screen.queryByRole('region', { name: 'Role permissions' }),
    ).toBeNull();
    const temporaryPassword = screen.getByLabelText('Temporary password');
    expect(temporaryPassword.getAttribute('minLength')).toBe('8');
    expect(temporaryPassword.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(temporaryPassword.getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(temporaryPassword.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    expect(
      await screen.findByText('No audit entries are available.'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/audit?limit=100',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('edits and deletes named settings drafts and renders voice previews', async () => {
    const savedDraft = {
      name: 'Reception defaults',
      version: 7,
      status: 'draft',
      greeting: {
        'ar-SA': 'مرحبًا، كيف يمكننا مساعدتك؟',
        en: 'Hello, how can we help you?',
        fr: 'Bonjour, comment pouvons-nous vous aider ?',
      },
      instructionTemplate: 'Use approved knowledge only.',
      voice: 'marin',
      maxCallSec: 300,
      businessHours: 'Monday to Friday',
      escalation: { hoursText: 'A team member will follow up.' },
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/settings')) {
        return jsonResponse(200, { active: null, drafts: [savedDraft] });
      }
      if (url.endsWith('/settings/draft/7') && init?.method === 'PUT') {
        return jsonResponse(200, {
          ...savedDraft,
          ...JSON.parse(String(init.body)),
          updatedAt: '2026-01-02T10:00:00.000Z',
        });
      }
      if (url.endsWith('/settings/draft/7') && init?.method === 'DELETE') {
        return jsonResponse(200, { status: 'deleted', version: 7 });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }));

    await screen.findByRole('button', { name: 'Edit' }, { timeout: 5000 });
    const arabicGreeting = screen.getByDisplayValue(
      'مرحبًا، كيف يمكننا مساعدتك؟',
    ) as HTMLInputElement;
    expect(arabicGreeting.readOnly).toBe(false);
    expect(
      (screen.getByLabelText('Greeting · English') as HTMLInputElement)
        .readOnly,
    ).toBe(false);
    const nameInput = screen.getByLabelText('Version name');
    expect(
      screen.getByLabelText('Preview marin voice').getAttribute('src'),
    ).toBe('/voice-samples/marin.mp3');
    const alloyPreview = screen.getByLabelText('Preview alloy voice');
    const marinPreview = screen.getByLabelText('Preview marin voice');
    const pausedPreviews: HTMLMediaElement[] = [];
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      pausedPreviews.push(this);
    });
    Object.defineProperty(marinPreview, 'currentTime', {
      configurable: true,
      writable: true,
      value: 12,
    });
    fireEvent.play(alloyPreview);
    expect(pausedPreviews).toContain(marinPreview);
    expect(pausedPreviews).not.toContain(alloyPreview);
    expect((marinPreview as HTMLAudioElement).currentTime).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((nameInput as HTMLInputElement).value).toBe('Reception defaults');
    fireEvent.change(nameInput, { target: { value: 'Updated reception' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));

    await screen.findByText('Version "Updated reception" updated.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/settings/draft/7',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"name":"Updated reception"'),
      }),
    );
    expect(screen.getByRole('row', { name: /Updated reception/ })).toBeTruthy();

    fireEvent.change(nameInput, { target: { value: 'Unsaved change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((nameInput as HTMLInputElement).value).toBe('Updated reception');

    fireEvent.click(screen.getByRole('button', { name: 'Delete version' }));
    await screen.findByText('No saved settings versions yet.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/settings/draft/7',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('creates a new draft when editing an archived settings version', async () => {
    const archivedVersion = {
      name: 'Previous receptionist',
      version: 4,
      status: 'archived',
      greeting: {
        'ar-SA': 'مرحبًا',
        en: 'Hello',
        fr: 'Bonjour',
      },
      instructionTemplate: 'Use the previous approved instructions.',
      voice: 'marin',
      maxCallSec: 300,
      businessHours: 'Monday to Friday',
      escalation: { hoursText: 'A team member will follow up.' },
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/settings')) {
        return jsonResponse(200, { active: null, drafts: [archivedVersion] });
      }
      if (url.endsWith('/settings/draft') && init?.method === 'PUT') {
        return jsonResponse(201, {
          ...JSON.parse(String(init.body)),
          version: 5,
          status: 'draft',
          createdAt: '2026-01-02T10:00:00.000Z',
          updatedAt: '2026-01-02T10:00:00.000Z',
        });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit as draft' }),
    );

    expect(
      (screen.getByLabelText('Version name') as HTMLInputElement).value,
    ).toBe('Previous receptionist');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(
      await screen.findByText('Settings saved as version 5.'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/settings/draft',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"name":"Previous receptionist"'),
      }),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === '/api/v1/admin/settings/draft/4',
      ),
    ).toBe(false);
    expect(
      screen
        .getAllByRole('row', { name: /Previous receptionist/ })
        .some((row) => row.textContent?.includes('Draft')),
    ).toBe(true);
  });

  it('limits viewer navigation to conversation history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith('/auth/me')) {
          return jsonResponse(200, {
            user: { email: 'viewer@example.com', role: 'viewer' },
            csrfToken: 'c'.repeat(43),
          });
        }
        if (url.endsWith('/conversations')) {
          return jsonResponse(200, { conversations: [] });
        }
        throw new Error(`Unexpected admin request: ${url}`);
      }),
    );

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Conversations', level: 1 });
    const navigation = screen.getByRole('navigation', { name: 'Workspace' });
    expect(screen.getByRole('button', { name: 'Conversations' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Knowledge base' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bookings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agent settings' })).toBeNull();
    expect(navigation).toBeTruthy();
  });

  it('keeps admins signed in when an action returns ADMIN_UNAUTHORIZED', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/users')) {
        return jsonResponse(200, {
          users: [
            {
              id: '0123456789abcdef01234567',
              email: 'agent@example.com',
              role: 'agent',
              disabled: false,
              createdAt: '2026-01-01T10:00:00.000Z',
            },
          ],
        });
      }
      if (
        url.endsWith('/users/0123456789abcdef01234567') &&
        init?.method === 'PATCH'
      ) {
        return jsonResponse(401, {
          error: {
            code: 'ADMIN_UNAUTHORIZED',
            message: 'Administrator login is required.',
          },
        });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    await screen.findByRole('button', { name: 'Disable' });
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Administrator login is required.',
    );
    expect(
      screen.getByRole('heading', { name: 'Users', level: 1 }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
  });

  it('saves a user role change through the admin API', async () => {
    const user = {
      id: '0123456789abcdef01234567',
      email: 'agent@example.com',
      role: 'agent',
      disabled: false,
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/users') && init?.method !== 'PATCH') {
        return jsonResponse(200, { users: [user] });
      }
      if (url.endsWith(`/users/${user.id}`) && init?.method === 'PATCH') {
        return jsonResponse(200, { ...user, role: 'editor' });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    const roleSelect = await screen.findByRole('combobox', {
      name: /agent@example.com/,
    });
    fireEvent.change(roleSelect, { target: { value: 'editor' } });

    await waitFor(() =>
      expect((roleSelect as HTMLSelectElement).value).toBe('editor'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/admin/users/${user.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'editor' }),
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows user deletion only for other users and removes users after confirmation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/users') && init?.method !== 'DELETE') {
        return jsonResponse(200, {
          users: [
            {
              id: '0123456789abcdef01234567',
              email: 'admin@example.com',
              role: 'admin',
              disabled: false,
              createdAt: '2026-01-01T10:00:00.000Z',
            },
            {
              id: 'abcdefabcdefabcdefabcdef',
              email: 'agent@example.com',
              role: 'agent',
              disabled: false,
              createdAt: '2026-01-02T10:00:00.000Z',
            },
          ],
        });
      }
      if (
        url.endsWith('/users/abcdefabcdefabcdefabcdef') &&
        init?.method === 'DELETE'
      ) {
        return jsonResponse(200, { status: 'deleted' });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    await screen.findByText('agent@example.com');

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(deleteButton.className).toContain('ap-admin-user-action--delete');
    expect(screen.getByRole('button', { name: 'Disable' }).className).toContain(
      'ap-admin-user-action--disable',
    );
    expect(deleteButton.closest('.ap-admin-user-actions')).toBeTruthy();
    expect(
      screen.getByRole('row', { name: /admin@example\.com/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('User agent@example.com deleted.'),
    ).toBeTruthy();
    expect(screen.queryByText('agent@example.com')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/users/abcdefabcdefabcdefabcdef',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('refreshes escalations when the active admin page regains focus', async () => {
    let escalationReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, {
          user: { email: 'admin@example.com', role: 'admin' },
          csrfToken: 'c'.repeat(43),
        });
      }
      if (url.endsWith('/knowledge/documents')) {
        return jsonResponse(200, { documents: [] });
      }
      if (url.endsWith('/escalations')) {
        escalationReads += 1;
        return jsonResponse(200, {
          escalations:
            escalationReads === 1
              ? []
              : [
                  {
                    id: '0123456789abcdef01234567',
                    sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
                    ticketRef: 'ESC-NEW',
                    reason: 'user_requested',
                    summary: 'Caller requested team follow-up.',
                    priority: 'normal',
                    status: 'open',
                    contactConsent: true,
                    contact: { phone: '+966500000001' },
                    notes: [],
                    slaDueAt: '2026-11-09T15:00:00.000Z',
                    createdAt: '2026-11-09T14:00:00.000Z',
                    updatedAt: '2026-11-09T14:00:00.000Z',
                  },
                ],
        });
      }
      throw new Error(`Unexpected admin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAdminApp();
    await screen.findByRole('heading', { name: 'Knowledge base', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Escalations' }));
    await screen.findByText('No escalations match this view.');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(
      await screen.findByText('Caller requested team follow-up.'),
    ).toBeTruthy();
    expect(escalationReads).toBe(2);
  });
});
