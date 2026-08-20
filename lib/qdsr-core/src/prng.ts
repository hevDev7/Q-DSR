/**
 * Deterministic pseudo-random number generation.
 *
 * Reproducibility is the trust model of this protocol: a third party must be able
 * to re-run a verification from the recorded seed and obtain bit-identical numbers.
 * `Math.random()` is therefore banned throughout `@workspace/qdsr-core` — every
 * stochastic step draws from a seeded generator.
 *
 * sfc32 (Small Fast Counter) is used because it is built entirely from 32-bit
 * integer operations, which behave identically on every JavaScript engine.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  nextInt(n: number): number;
}

/** Expands a single 32-bit seed into a well-mixed state word. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^= t >>> 15) >>> 0;
  };
}

/** Creates a deterministic generator from a 32-bit integer seed. */
export function createRng(seed: number): Rng {
  const mix = splitmix32(seed | 0);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();

  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    c = (c + t) >>> 0;
    return t >>> 0;
  };

  // Discard the first draws so the output does not depend on seed structure.
  for (let i = 0; i < 12; i++) next();

  return {
    next: () => next() / 4294967296,
    nextInt: (n: number) => Math.floor((next() / 4294967296) * n),
  };
}

/** Turns an arbitrary string into a 32-bit seed (FNV-1a). Used for named runs. */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
