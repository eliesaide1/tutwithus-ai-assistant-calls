import { describe, expect, it, vi } from 'vitest';
import { ScreenWakeLock } from '../src/screen/voice/screen-wake-lock';

class VisibilityPage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

class Sentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

describe('voice call screen wake lock', () => {
  it('holds the screen lock, reacquires it after returning, and releases it', async () => {
    const page = new VisibilityPage();
    const first = new Sentinel();
    const second = new Sentinel();
    const request = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const wakeLock = new ScreenWakeLock(page as unknown as Document, {
      request,
    });

    await wakeLock.start();
    expect(request).toHaveBeenCalledWith('screen');

    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    await first.release();
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    await wakeLock.stop();
    expect(second.release).toHaveBeenCalledOnce();
  });

  it('does not affect the call when the browser has no wake-lock support', async () => {
    const wakeLock = new ScreenWakeLock(
      new VisibilityPage() as unknown as Document,
      undefined,
    );
    await expect(wakeLock.start()).resolves.toBeUndefined();
    await expect(wakeLock.stop()).resolves.toBeUndefined();
  });
});
