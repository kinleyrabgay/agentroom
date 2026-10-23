/**
 * A prompt stream the run can keep writing to: the first message starts the run, later ones are
 * steers. The SDK reads it until it's closed, so a closed channel ends the run after its current turn.
 */
export class InputChannel<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private wake: (() => void) | null = null;
  private done = false;

  get closed() {
    return this.done;
  }

  /** Returns false once the channel is closed. */
  push(item: T): boolean {
    if (this.done) return false;
    this.buffer.push(item);
    this.wake?.();
    return true;
  }

  close() {
    this.done = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.buffer.length) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }
}
