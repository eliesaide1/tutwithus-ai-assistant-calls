import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AP_TutorCarousel } from '../src/screen/voice/components/AP_TutorCarousel';

const profiles = ['First Tutor', 'Second Tutor', 'Third Tutor'].map(
  (fullName, index) => ({
    fullName,
    profilePic: `https://cdn.example.com/${index + 1}.jpg`,
  }),
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('tutor carousel', () => {
  it('advances in order and restarts automatic rotation after manual navigation', () => {
    vi.useFakeTimers();
    render(<AP_TutorCarousel profiles={profiles} onImageError={vi.fn()} />);

    const track = document.querySelector('.ap-tutor-carousel__track');
    expect(track?.getAttribute('style')).toContain('translateX(-0%)');

    fireEvent.click(screen.getByRole('button', { name: 'Next tutor' }));
    expect(track?.getAttribute('style')).toContain('translateX(-100%)');

    act(() => vi.advanceTimersByTime(2_999));
    expect(track?.getAttribute('style')).toContain('translateX(-100%)');
    act(() => vi.advanceTimersByTime(1));
    expect(track?.getAttribute('style')).toContain('translateX(-200%)');
    act(() => vi.advanceTimersByTime(3_000));
    expect(track?.getAttribute('style')).toContain('translateX(-0%)');
  });

  it('moves one tutor per swipe', () => {
    render(<AP_TutorCarousel profiles={profiles} onImageError={vi.fn()} />);
    const carousel = screen.getByRole('region', { name: 'Tutor profiles' });
    const track = document.querySelector('.ap-tutor-carousel__track');

    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(pointerDown, 'clientX', { value: 180 });
    fireEvent(carousel, pointerDown);
    const pointerUp = new Event('pointerup', { bubbles: true });
    Object.defineProperty(pointerUp, 'clientX', { value: 100 });
    fireEvent(carousel, pointerUp);
    expect(track?.getAttribute('style')).toContain('translateX(-100%)');
  });
});
