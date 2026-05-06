class TokenBucket {
  constructor({ rpm }) {
    this.capacity = rpm;
    this.refillPerMs = rpm / 60000;
    this.tokens = rpm;
    this.last = Date.now();
  }
  _refill() {
    const now = Date.now();
    const delta = (now - this.last) * this.refillPerMs;
    this.tokens = Math.min(this.capacity, this.tokens + delta);
    this.last = now;
  }
  async acquire(maxWaitMs = 0) {
    this._refill();
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    if (maxWaitMs <= 0) return false;
    const needed = 1 - this.tokens;
    const waitMs = Math.ceil(needed / this.refillPerMs);
    if (waitMs > maxWaitMs) return false;
    await new Promise(r => setTimeout(r, waitMs));
    this._refill();
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

module.exports = { TokenBucket };
