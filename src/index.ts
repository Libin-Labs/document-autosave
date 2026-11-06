export interface AutosaveScheduler {
  now(): number;
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
}
export interface SaveRevision {
  revision: number;
  text: string;
  updatedAt: number;
}
export interface AutosaveStatus {
  revision: number;
  savedRevision: number;
  dirty: boolean;
  saving: boolean;
  error: unknown;
}
export interface Autosave {
  update(text: string): number;
  flush(): Promise<void>;
  cancel(): void;
  status(): AutosaveStatus;
}
/** Serializes persistence; edits during a write are drained by the same flush. */
export function createAutosave(
  persist: (revision: Readonly<SaveRevision>) => Promise<void>,
  scheduler: AutosaveScheduler,
  options: { delay?: number; onError?: (error: unknown) => void } = {},
): Autosave {
  const delay = options.delay ?? 500;
  if (
    !Number.isFinite(delay) ||
    delay < 0 ||
    delay > 86_400_000 ||
    typeof persist !== 'function' ||
    typeof scheduler.now !== 'function' ||
    typeof scheduler.schedule !== 'function' ||
    typeof scheduler.cancel !== 'function'
  )
    throw new TypeError('Invalid autosave configuration');
  let latest: Readonly<SaveRevision> | null = null,
    saved = 0,
    error: unknown = null;
  let timer: { handle: unknown } | null = null,
    active: Promise<void> | null = null;
  let token = 0;
  function clear(): void {
    token++;
    const old = timer;
    timer = null;
    if (old) scheduler.cancel(old.handle);
  }
  function flush(): Promise<void> {
    clear();
    if (active) return active;
    if (!latest || latest.revision <= saved) return Promise.resolve();
    active = Promise.resolve().then(async () => {
      try {
        while (latest && latest.revision > saved) {
          const target = latest;
          await persist(target);
          saved = target.revision;
          error = null;
        }
      } catch (failure) {
        error = failure;
        throw failure;
      } finally {
        active = null;
      }
    });
    return active;
  }
  return {
    update(text) {
      if (typeof text !== 'string' || text.length > 1_000_000) throw new RangeError('Text limit');
      const now = scheduler.now();
      if (!Number.isFinite(now) || Math.abs(now) > Number.MAX_SAFE_INTEGER)
        throw new RangeError('Invalid scheduler clock');
      if (latest && latest.revision >= Number.MAX_SAFE_INTEGER)
        throw new RangeError('Revision exhausted');
      clear();
      latest = Object.freeze({ revision: (latest?.revision ?? 0) + 1, text, updatedAt: now });
      const current = token;
      const handle = scheduler.schedule(() => {
        if (current !== token) return;
        timer = null;
        void flush().catch((failure) => {
          try {
            options.onError?.(failure);
          } catch {
            /* Notification must not create an unhandled rejection. */
          }
        });
      }, delay);
      timer = { handle };
      return latest.revision;
    },
    flush,
    cancel: clear,
    status: () => ({
      revision: latest?.revision ?? 0,
      savedRevision: saved,
      dirty: (latest?.revision ?? 0) > saved,
      saving: active !== null,
      error,
    }),
  };
}
