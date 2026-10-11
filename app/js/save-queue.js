// Platform-independent, acknowledged saves. One request per document key at a time.
export class SaveQueue {
  constructor({ write, changed = () => {}, persist = () => {}, delay = 350, schedule = (fn, ms) => setTimeout(fn, ms), cancel = timer => clearTimeout(timer) }) {
    Object.assign(this, { write, changed, persist, delay, schedule, cancel });
    this.entries = new Map();
    this.lastSaved = null;
    this.generation = 0; // Monotonic across acknowledged saves, for guarding asynchronous reads.
  }
  notify() {
    this.persist([...this.entries].map(([key, e]) => ({ key, data: e.data })));
    this.changed({ saving: this.entries.size, failed: [...this.entries.values()].some(e => e.error), lastSaved: this.lastSaved });
  }
  enqueue(key, data) {
    this.generation++;
    const e = this.entries.get(key) ?? { generation: 0, attempts: 0 };
    e.data = structuredClone(data); e.generation++; e.error = null; e.attempts = 0;
    this.cancel(e.timer); this.entries.set(key, e);
    if (!e.running) e.timer = this.schedule(() => this.run(key), this.delay);
    this.notify();
  }
  async run(key, options = {}) {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.running) { await e.running; return; }
    this.cancel(e.timer); e.timer = null;
    const generation = e.generation;
    e.running = (async () => {
      try {
        await this.write(key, structuredClone(e.data), options);
        e.error = null; e.attempts = 0;
        if (generation === e.generation) { this.entries.delete(key); this.lastSaved = Date.now(); }
      } catch (error) {
        e.error = error; e.attempts++;
        // A conflict needs a human decision; a failed write is NEVER acknowledged.
        if (error.status !== 409 && e.attempts <= 6) e.timer = this.schedule(() => this.run(key), Math.min(3000 * e.attempts, 18000));
      }
    })();
    await e.running; e.running = null;
    if (this.entries.has(key) && generation !== e.generation && !e.error) e.timer = this.schedule(() => this.run(key), 0);
    this.notify();
  }
  async flush(options = {}) {
    // New edits made during a request are drained in sequence, not sent concurrently.
    while (this.entries.size) {
      await Promise.all([...this.entries.keys()].map(key => this.run(key, options)));
      const error = [...this.entries.values()].find(e => e.error)?.error;
      if (error) throw error;
    }
  }
  discard() { this.generation++; for (const e of this.entries.values()) this.cancel(e.timer); this.entries.clear(); this.notify(); }
  get dirty() { return this.entries.size > 0; }
}
