import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AP_BundleCarousel } from '../src/screen/voice/components/AP_BundleCarousel';

const carousel = {
  subjectName: 'Python',
  activeFamilyId: 'tech',
  families: [
    {
      id: 'tech',
      name: 'Tech Programs',
      deliveryMode: 'one_to_one' as const,
      editions: [
        {
          id: 'tech-5',
          name: 'Tech Programs Start',
          sessions: 5,
          totalPrice: 1075,
          pricePerSession: 215,
          currency: 'SAR' as const,
        },
        {
          id: 'tech-10',
          name: 'Tech Programs Boost',
          sessions: 10,
          totalPrice: 1800,
          pricePerSession: 180,
          currency: 'SAR' as const,
        },
      ],
    },
    {
      id: 'group',
      name: 'Tech Group',
      deliveryMode: 'group' as const,
      editions: [
        {
          id: 'group-5',
          name: 'Tech Group Start',
          sessions: 5,
          totalPrice: 4045,
          pricePerSession: 809,
          currency: 'SAR' as const,
        },
      ],
    },
  ],
};

describe('bundle recommendation carousel', () => {
  it('switches session editions and compatible bundle families', () => {
    render(<AP_BundleCarousel carousel={carousel} locale="en" />);

    expect(screen.getByRole('heading', { name: 'Tech Programs' })).toBeTruthy();
    expect(screen.getByText(/1,075/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /10 sessions/i }));
    expect(screen.getByText(/1,800/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next bundle' }));
    expect(screen.getByRole('heading', { name: 'Tech Group' })).toBeTruthy();
    expect(screen.getByText(/4,045/)).toBeTruthy();
  });
});
