import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Escalation } from '@tutwithus/contracts/admin';
import { messages } from '../src/shared/i18n.js';
import { AP_EscalationsPage } from '../src/screen/admin/escalations/pages/AP_EscalationsPage.js';

const escalations: Escalation[] = [
  {
    id: '0123456789abcdef01234567',
    sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
    ticketRef: 'ESC-OPEN',
    reason: 'safety',
    summary: 'Caller asked for a private concern to be reviewed.',
    priority: 'urgent',
    status: 'open',
    contactConsent: true,
    contact: { phone: '+966500000001' },
    notes: [],
    slaDueAt: '2026-11-09T15:00:00.000Z',
    createdAt: '2026-11-09T14:00:00.000Z',
    updatedAt: '2026-11-09T14:00:00.000Z',
  },
  {
    id: '1123456789abcdef01234567',
    sessionId: '54f887b3-14b8-4f82-a18f-69e5d8215c7c',
    ticketRef: 'ESC-PROGRESS',
    reason: 'complaint',
    summary: 'A team member is reviewing the lesson complaint.',
    priority: 'high',
    status: 'claimed',
    contactConsent: true,
    contact: { phone: '+966500000002' },
    notes: [],
    slaDueAt: '2026-11-09T18:00:00.000Z',
    createdAt: '2026-11-09T14:00:00.000Z',
    updatedAt: '2026-11-09T14:00:00.000Z',
  },
  {
    id: '2123456789abcdef01234567',
    sessionId: '64f887b3-14b8-4f82-a18f-69e5d8215c7c',
    ticketRef: 'ESC-CLOSED',
    reason: 'user_requested',
    summary: 'The caller was contacted by the team.',
    priority: 'normal',
    status: 'resolved',
    contactConsent: true,
    contact: { phone: '+966500000003' },
    notes: [],
    slaDueAt: '2026-11-10T14:00:00.000Z',
    createdAt: '2026-11-09T14:00:00.000Z',
    updatedAt: '2026-11-09T14:00:00.000Z',
  },
];

describe('AP_EscalationsPage', () => {
  it('filters open, in-progress, and closed tickets and shows the consented callback number', () => {
    const onUpdate = vi.fn();
    const setNoteDrafts: Dispatch<
      SetStateAction<Record<string, string>>
    > = () => undefined;
    function Harness() {
      const [filter, setFilter] = useState<'all' | Escalation['status']>('all');
      return (
        <AP_EscalationsPage
          text={messages.en}
          locale="en"
          isAdmin
          escalations={escalations}
          filter={filter}
          priorityFilter="all"
          loading={false}
          busyAction={null}
          noteDrafts={{}}
          setFilter={setFilter}
          setPriorityFilter={() => undefined}
          setNoteDrafts={setNoteDrafts}
          onUpdate={onUpdate}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole('navigation', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In progress 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Closed 1' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '+966500000001' }).getAttribute('href'),
    ).toBe('tel:+966500000001');
    const openStatus = within(
      screen.getByRole('group', { name: 'Status: ESC-OPEN' }),
    );
    expect(
      openStatus
        .getByRole('button', { name: 'Open' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(openStatus.getByRole('button', { name: 'In progress' }));
    expect(onUpdate).toHaveBeenCalledWith(escalations[0], {
      action: 'claim',
    });

    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Status: ESC-PROGRESS' }),
      ).getByRole('button', { name: 'Closed' }),
    );
    expect(onUpdate).toHaveBeenCalledWith(escalations[1], {
      action: 'resolve',
    });
    fireEvent.click(
      within(
        screen.getByRole('group', { name: 'Status: ESC-CLOSED' }),
      ).getByRole('button', { name: 'Open' }),
    );
    expect(onUpdate).toHaveBeenCalledWith(escalations[2], {
      action: 'reopen',
    });

    fireEvent.click(screen.getByRole('button', { name: 'In progress 1' }));
    expect(
      screen.getByText('A team member is reviewing the lesson complaint.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('The caller was contacted by the team.'),
    ).toBeNull();
  });
});
