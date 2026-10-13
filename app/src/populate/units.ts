// Converting quantities between units of the same dimension: the UCUM units
// patient data and questionnaires use for lengths, masses and durations.

const FACTORS: Record<string, { dimension: string; factor: number }> = {
  m: { dimension: "length", factor: 1 },
  cm: { dimension: "length", factor: 0.01 },
  mm: { dimension: "length", factor: 0.001 },
  "[in_i]": { dimension: "length", factor: 0.0254 },
  "[ft_i]": { dimension: "length", factor: 0.3048 },
  kg: { dimension: "mass", factor: 1 },
  g: { dimension: "mass", factor: 0.001 },
  mg: { dimension: "mass", factor: 1e-6 },
  ug: { dimension: "mass", factor: 1e-9 },
  "[lb_av]": { dimension: "mass", factor: 0.45359237 },
  s: { dimension: "time", factor: 1 },
  min: { dimension: "time", factor: 60 },
  h: { dimension: "time", factor: 3600 },
  d: { dimension: "time", factor: 86400 },
  wk: { dimension: "time", factor: 604800 },
  mo: { dimension: "time", factor: 2629800 },
  a: { dimension: "time", factor: 31557600 },
};

/** `value` in unit `from` expressed in unit `to`, or undefined when either is unknown or they measure different things. */
export function convert(value: number, from: string, to: string): number | undefined {
  if (from === to) return value;
  const [source, target] = [FACTORS[from], FACTORS[to]];
  if (!source || !target || source.dimension !== target.dimension) return undefined;
  // Twelve significant digits: 1.65 m is 165 cm, not 164.99999999999997.
  return Number(((value * source.factor) / target.factor).toPrecision(12));
}

/** A duration in milliseconds, for observationLinkPeriod. */
export function durationMs(value: number, unit: string): number | undefined {
  const seconds = convert(value, unit, "s");
  return seconds === undefined ? undefined : seconds * 1000;
}
