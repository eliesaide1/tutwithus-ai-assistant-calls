import type { Dispatch, SetStateAction } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookingRequest } from '@tutwithus/contracts/admin';
import { messages } from '../src/shared/i18n.js';
import { AP_BookingRequestsPage } from '../src/screen/admin/bookings/pages/AP_BookingRequestsPage.js';

const booking: BookingRequest = {
  id: '0123456789abcdef01234567',
  sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
  reference: 'BK-123',
  status: 'submitted',
  subject: 'Mathematics',
  level: 'Grade 8',
  tutorId: 'tutor-1',
  tutorName: 'Taylor Tutor',
  sessionStart: '2026-11-12T10:00:00.000Z',
  sessionEnd: '2026-11-12T11:00:00.000Z',
  customerId: 'customer-1',
  preferredTimes: [],
  timezone: 'Asia/Riyadh',
  notes: [],
  createdAt: '2026-11-09T10:00:00.000Z',
  updatedAt: '2026-11-09T10:00:00.000Z',
};

describe('AP_BookingRequestsPage', () => {
  it('shows tutor/session details and lets admins confirm or cancel a request', () => {
    const onUpdate = vi.fn();
    const setNoteDrafts: Dispatch<
      SetStateAction<Record<string, string>>
    > = () => undefined;
    render(
      <AP_BookingRequestsPage
        text={messages.en}
        locale="en"
        isAdmin
        isAgent={false}
        bookings={[booking]}
        users={[]}
        filter="all"
        loading={false}
        busyAction={null}
        noteDrafts={{}}
        setFilter={() => undefined}
        setNoteDrafts={setNoteDrafts}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText('Taylor Tutor')).toBeTruthy();
    expect(screen.getByText('customer-1')).toBeTruthy();
    expect(screen.getByText('Not provided')).toBeTruthy();
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm booking',
    });
    const cancelButton = screen.getByRole('button', {
      name: 'Cancel request',
    });

    fireEvent.click(confirmButton);
    fireEvent.click(cancelButton);
    expect(onUpdate).toHaveBeenNthCalledWith(1, booking, {
      status: 'confirmed',
    });
    expect(onUpdate).toHaveBeenNthCalledWith(2, booking, {
      status: 'cancelled',
    });
  });
});
