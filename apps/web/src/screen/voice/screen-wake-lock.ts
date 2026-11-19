type WakeLockSentinelLike = EventTarget & {
  readonly released: boolean;
  release(): Promise<void>;
};

type WakeLockProvider = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

type VisibilityDocument = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

export class ScreenWakeLock {
  private active = false;
  private acquiring?: Promise<void>;
  private sentinel?: WakeLockSentinelLike;

  constructor(
    private readonly page: VisibilityDocument = document,
    private readonly provider: WakeLockProvider | undefined = (
      navigator as Navigator & { wakeLock?: WakeLockProvider }
    ).wakeLock,
  ) {}

  start(): Promise<void> {
    if (!this.active) {
      this.active = true;
      this.page.addEventListener('visibilitychange', this.handleVisibility);
    }
    return this.acquire();
  }

  async stop(): Promise<void> {
    if (!this.active && !this.sentinel && !this.acquiring) return;
    this.active = false;
    this.page.removeEventListener('visibilitychange', this.handleVisibility);
    await this.acquiring?.catch(() => undefined);
    const sentinel = this.sentinel;
    this.sentinel = undefined;
    if (sentinel && !sentinel.released) {
      await sentinel.release().catch(() => undefined);
    }
  }

  private readonly handleVisibility = () => {
    if (this.active && this.page.visibilityState === 'visible') {
      void this.acquire();
    }
  };

  private acquire(): Promise<void> {
    if (
      !this.active ||
      !this.provider ||
      this.page.visibilityState !== 'visible' ||
      (this.sentinel && !this.sentinel.released)
    ) {
      return Promise.resolve();
    }
    if (this.acquiring) return this.acquiring;
    this.acquiring = this.provider
      .request('screen')
      .then(async (sentinel) => {
        if (!this.active) {
          await sentinel.release().catch(() => undefined);
          return;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener(
          'release',
          () => {
            if (this.sentinel === sentinel) this.sentinel = undefined;
          },
          { once: true },
        );
      })
      .catch(() => undefined)
      .finally(() => {
        this.acquiring = undefined;
      });
    return this.acquiring;
  }
}
