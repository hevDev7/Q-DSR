/**
 * Standard normal distribution — CDF and quantile function.
 *
 * Accuracy matters here: the Deflated Sharpe Ratio *is* a normal CDF evaluation,
 * so any error in `normalCdf` propagates straight into the certification verdict.
 * We therefore use the regularised incomplete gamma function (series + continued
 * fraction) rather than a cheap polynomial approximation.
 */

const SQRT2 = Math.SQRT2;
const EPS = 2.220446049250313e-16;
const FPMIN = Number.MIN_VALUE / EPS;
const ITMAX = 300;

/** Lanczos approximation of ln|Γ(x)| for x > 0. */
export function lnGamma(x: number): number {
  const cof = [
    57.1562356658629235, -59.5979603554754912, 14.1360979747417471,
    -0.491913816097620199, 0.339946499848118887e-4, 0.465236289270485756e-4,
    -0.983744753048795646e-4, 0.158088703224912494e-3, -0.210264441724104883e-3,
    0.217439618115212643e-3, -0.164318106536763890e-3, 0.844182239838527433e-4,
    -0.261908384015814087e-4, 0.368991826595316234e-5,
  ];
  let y = x;
  const tmp = x + 5.24218750000000000;
  let out = (x + 0.5) * Math.log(tmp) - tmp;
  let ser = 0.999999999999997092;
  for (let j = 0; j < 14; j++) ser += cof[j]! / ++y;
  return out + Math.log(2.5066282746310005 * ser / x);
}

/** Regularised lower incomplete gamma P(a,x) via its series expansion. */
function gammaPSeries(a: number, x: number): number {
  const gln = lnGamma(a);
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln);
}

/** Regularised upper incomplete gamma Q(a,x) via its continued fraction. */
function gammaQContinuedFraction(a: number, x: number): number {
  const gln = lnGamma(a);
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) <= EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new RangeError('gammaP: invalid arguments');
  if (x === 0) return 0;
  if (x < a + 1) return gammaPSeries(a, x);
  return 1 - gammaQContinuedFraction(a, x);
}

/** Error function, accurate to near machine precision. */
export function erf(x: number): number {
  if (x === 0) return 0;
  const p = gammaP(0.5, x * x);
  return x < 0 ? -p : p;
}

/** Complementary error function. Uses the upper branch directly to stay accurate in the tail. */
export function erfc(x: number): number {
  const ax = Math.abs(x);
  const xx = ax * ax;
  const upper = xx < 1.5 ? 1 - gammaPSeries(0.5, xx) : gammaQContinuedFraction(0.5, xx);
  return x >= 0 ? upper : 2 - upper;
}

/** Standard normal cumulative distribution function Φ(x). */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  return 0.5 * erfc(-x / SQRT2);
}

/** Standard normal probability density function φ(x). */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal quantile function Φ⁻¹(p).
 *
 * Acklam's rational approximation (|ε| < 1.15e-9) followed by one Halley
 * refinement step against our high-accuracy `normalCdf`, which lands the result
 * at full double precision.
 */
export function normalInv(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    throw new RangeError(`normalInv: p must be in (0,1), got ${p}`);
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }

  // Halley refinement
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}
