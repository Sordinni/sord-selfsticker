export class QueueFullError extends Error {}

/**
 * Bounded per-key and global async work queue for CPU/memory-heavy media tasks.
 */
export class WorkQueue {
  constructor({ concurrency, maxPending, maxPerKey }) {
    for (const value of [concurrency, maxPending, maxPerKey]) {
      if (!Number.isInteger(value) || value < 1) {
        throw new TypeError("Invalid queue limit");
      }
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
    this.maxPerKey = maxPerKey;
    this.running = 0;
    this.pending = [];
    this.perKey = new Map();
    this.closed = false;
    this.idleWaiters = [];
    this.blockedKeys = new Set();
    this.keyWaiters = new Map();
  }

  run(key, task) {
    if (typeof task !== "function") return Promise.reject(new TypeError("Task required"));
    if (this.closed || this.blockedKeys.has(key)) {
      return Promise.reject(new QueueFullError("Serviço ou sessão encerrando"));
    }
    if (
      (this.perKey.get(key) || 0) >= this.maxPerKey ||
      (this.running >= this.concurrency && this.pending.length >= this.maxPending)
    ) {
      return Promise.reject(new QueueFullError("Fila de mídia cheia"));
    }

    this.perKey.set(key, (this.perKey.get(key) || 0) + 1);
    return new Promise((resolve, reject) => {
      this.pending.push({ key, task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.running++;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running--;
          const count = this.perKey.get(item.key) - 1;
          if (count) this.perKey.set(item.key, count);
          else this.perKey.delete(item.key);

          if (!count) {
            for (const resolve of this.keyWaiters.get(item.key) || []) resolve();
            this.keyWaiters.delete(item.key);
          }
          if (!this.running && !this.pending.length) {
            this.idleWaiters.splice(0).forEach((resolve) => resolve());
          }
          this.drain();
        });
    }
  }

  async stopKey(key) {
    this.blockedKeys.add(key);
    const remaining = [];
    for (const item of this.pending) {
      if (item.key !== key) {
        remaining.push(item);
        continue;
      }
      const count = this.perKey.get(key) - 1;
      if (count) this.perKey.set(key, count);
      else this.perKey.delete(key);
      item.reject(new QueueFullError("Sessão encerrando"));
    }
    this.pending = remaining;

    if (this.perKey.get(key)) {
      await new Promise((resolve) => {
        const waiters = this.keyWaiters.get(key) || [];
        waiters.push(resolve);
        this.keyWaiters.set(key, waiters);
      });
    }
  }

  releaseKey(key) {
    this.blockedKeys.delete(key);
  }

  async close() {
    this.closed = true;
    for (const item of this.pending.splice(0)) {
      const count = this.perKey.get(item.key) - 1;
      if (count) this.perKey.set(item.key, count);
      else this.perKey.delete(item.key);
      item.reject(new QueueFullError("Serviço encerrando"));
    }
    if (this.running) {
      await new Promise((resolve) => this.idleWaiters.push(resolve));
    }
  }
}
