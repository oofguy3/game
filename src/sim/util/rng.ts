/** splitmix32 output function: a well-avalanching 32-bit finalizer. */
function mix32(x: number): number {
  let t = x ^ (x >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return t >>> 0;
}

const GOLDEN = 0x9e3779b9;
const WARMUP_ROUNDS = 12;

/**
 * Deterministic PRNG: sfc32 whose four state words are seeded through splitmix32.
 * The only source of randomness permitted in src/sim and src/shared.
 */
export class Rng {
  private readonly seed: number;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this.seed = seed | 0;
    let s = this.seed;
    const splitmix32 = (): number => {
      s = (s + GOLDEN) | 0;
      return mix32(s);
    };
    this.a = splitmix32();
    this.b = splitmix32();
    this.c = splitmix32();
    this.d = splitmix32();
    for (let i = 0; i < WARMUP_ROUNDS; i++) this.nextUint32();
  }

  private nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly chosen element; throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  /**
   * Independent child stream derived from this Rng's seed and `salt`.
   * Depends only on (seed, salt): never reads or advances the parent's current state.
   */
  fork(salt: number): Rng {
    return new Rng(mix32((mix32(this.seed) + Math.imul(salt | 0, GOLDEN)) | 0));
  }
}
