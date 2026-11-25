export class FixedWindowLimiter {
  constructor({ windowMs, maxBuckets = 20000, now = () => Date.now() }) {
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
    this.now = now;
    this.buckets = new Map();
    this.nextPrune = 0;
  }

  allow(key, limit) {
    const now = this.now();
    if (now >= this.nextPrune) {
      for (const [item, value] of this.buckets) {
        if (value.expires <= now) this.buckets.delete(item);
      }
      this.nextPrune = now + Math.min(this.windowMs, 60000);
    }

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.expires <= now) {
      if (!bucket && this.buckets.size >= this.maxBuckets) return false;
      bucket = { count: 0, expires: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count++;
    return bucket.count <= limit;
  }
}
