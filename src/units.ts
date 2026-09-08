/**
 * Display units. Everything inside the generator is millimetres; this module
 * exists only to put numbers in front of a person.
 */
export type Units = 'metric' | 'imperial'

export const MM_PER_IN = 25.4
export const inch = (mm: number) => mm / MM_PER_IN
export const mm = (inches: number) => inches * MM_PER_IN

/** Nearest fraction of an inch, reduced. `1.375` becomes `1-3/8`. */
export function inchFraction(inches: number, denom = 16): string {
  const sign = inches < 0 ? '-' : ''
  const v = Math.abs(inches)
  let whole = Math.floor(v)
  let num = Math.round((v - whole) * denom)
  let den = denom
  if (num === den) { whole += 1; num = 0 }
  while (num > 0 && num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2 }
  if (num === 0) return `${sign}${whole}`
  if (whole === 0) return `${sign}${num}/${den}`
  return `${sign}${whole}-${num}/${den}`
}

/** Feet and inches, for anything long enough that inches alone read badly. */
export function feetInches(mm0: number, denom = 8): string {
  const total = inch(mm0)
  let ft = Math.floor(total / 12)
  // round the inches first, so 95.99" comes out as 8'0" rather than 7'12"
  let rest = Math.round((total - ft * 12) * denom) / denom
  if (rest >= 12) { ft += 1; rest -= 12 }
  return ft > 0 ? `${ft}'${inchFraction(rest, denom)}"` : `${inchFraction(rest, denom)}"`
}

/** A length in the chosen unit. Long values go to feet and inches. */
export function fmtLen(mm0: number, units: Units, opts: { feet?: boolean } = {}): string {
  if (units === 'metric') {
    return `${Math.abs(mm0) >= 100 ? Math.round(mm0) : Math.round(mm0 * 10) / 10} mm`
  }
  const useFeet = opts.feet ?? Math.abs(mm0) >= 24 * MM_PER_IN
  return useFeet ? feetInches(mm0) : `${inchFraction(inch(mm0), 32)}"`
}

/** The same length written the other way round, for a secondary readout. */
export function fmtAlt(mm0: number, units: Units): string {
  return units === 'metric' ? fmtLen(mm0, 'imperial') : `${Math.round(mm0 * 10) / 10} mm`
}

export function fmtArea(mm2: number, units: Units): string {
  return units === 'metric'
    ? `${(mm2 / 1e6).toFixed(2)} m²`
    : `${(mm2 / 1e6 * 10.7639).toFixed(1)} sq ft`
}

export function fmtVolume(litres: number, units: Units): string {
  return units === 'metric' ? `${litres} L` : `${litres} L (${(litres * 0.0353147).toFixed(1)} cu ft)`
}

export function fmtMass(kg: number, units: Units): string {
  return units === 'metric' ? `${kg} kg` : `${(kg * 2.20462).toFixed(1)} lb`
}

/** Common sheet stock, so nobody has to type 2438.4. */
export interface StockOption { label: string; value: number; note?: string }

export const SHEET_SIZES: Record<Units, { label: string; length: number; width: number }[]> = {
  imperial: [
    { label: `8' x 4'`, length: mm(96), width: mm(48) },
    { label: `10' x 5'`, length: mm(120), width: mm(60) },
    { label: `5' x 5'`, length: mm(60), width: mm(60) },
    { label: `4' x 2'`, length: mm(48), width: mm(24) },
    { label: `24" x 12"`, length: mm(24), width: mm(12) },
  ],
  metric: [
    { label: '2440 x 1220', length: 2440, width: 1220 },
    { label: '3050 x 1525', length: 3050, width: 1525 },
    { label: '1525 x 1525', length: 1525, width: 1525 },
    { label: '1220 x 610', length: 1220, width: 610 },
    { label: '600 x 300', length: 600, width: 300 },
  ],
}

export const PLY_THICKNESS: Record<Units, StockOption[]> = {
  imperial: [
    { label: '1/8"', value: mm(1 / 8) },
    { label: '3/16"', value: mm(3 / 16) },
    { label: '1/4"', value: mm(1 / 4) },
    { label: '3/8"', value: mm(3 / 8) },
    { label: '1/2"', value: mm(1 / 2) },
  ],
  metric: [
    { label: '3 mm', value: 3 },
    { label: '4 mm', value: 4 },
    { label: '6 mm', value: 6 },
    { label: '9 mm', value: 9 },
    { label: '12 mm', value: 12 },
  ],
}

export const SKIN_THICKNESS: Record<Units, StockOption[]> = {
  imperial: [
    { label: '1/16"', value: mm(1 / 16) },
    { label: '3/32"', value: mm(3 / 32) },
    { label: '1/8"', value: mm(1 / 8) },
    { label: '3/16"', value: mm(3 / 16) },
    { label: '1/4"', value: mm(1 / 4) },
  ],
  metric: [
    { label: '1.5 mm', value: 1.5 },
    { label: '2 mm', value: 2 },
    { label: '3 mm', value: 3 },
    { label: '4 mm', value: 4 },
    { label: '6 mm', value: 6 },
  ],
}

export const FOAM_THICKNESS: Record<Units, StockOption[]> = {
  imperial: [
    { label: '1/2"', value: mm(1 / 2) },
    { label: '3/4"', value: mm(3 / 4) },
    { label: '1"', value: mm(1) },
    { label: '1-1/2"', value: mm(1.5) },
    { label: '2"', value: mm(2) },
  ],
  metric: [
    { label: '12 mm', value: 12 },
    { label: '20 mm', value: 20 },
    { label: '25 mm', value: 25 },
    { label: '40 mm', value: 40 },
    { label: '50 mm', value: 50 },
  ],
}

/** Slider step in millimetres, so imperial mode lands on real fractions. */
export function stepFor(units: Units, metricStep: number, imperialInches?: number): number {
  if (units === 'metric' || !imperialInches) return metricStep
  return mm(imperialInches)
}
