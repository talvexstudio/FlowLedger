type LockTask<T> = () => T | Promise<T>;

class AsyncDataLock {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: LockTask<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const dataLock = new AsyncDataLock();

/**
 * Serializes all canonical JSON writes and coherent multi-store reads inside
 * the local FlowLedger server process.
 */
export const withDataLock = <T>(task: LockTask<T>): Promise<T> =>
  dataLock.runExclusive(task);
