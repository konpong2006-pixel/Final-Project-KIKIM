import type {BurnoutDynamicInsight} from '@/services/dynamic-insights';

export type BurnoutRiskLevel = BurnoutDynamicInsight['riskLevel'];

/**
 * The Thai label and the colour for each risk band, kept in one table so the
 * meter and the text can never disagree. Both are looked up by `riskLevel`,
 * which `calculateBurnoutDynamicInsight` derives from the score -- so the only
 * way for the bar to say something the label does not is for the model itself
 * to change, and then both move together.
 *
 * The thresholds that pick the level live in `dynamic-insights.ts` and are
 * deliberately not repeated here; duplicating them is exactly how a bar starts
 * contradicting the words beside it.
 *
 * Colours are the sage/amber/red set the monthly-budget meter already uses,
 * rather than a new palette invented for this one card.
 */
export const BURNOUT_RISK_BANDS: Record<BurnoutRiskLevel, {
  /** Fill colour for the meter and the accent for the band. */
  color: string;
  /** Thai label shown beside the score. Never rendered from colour alone. */
  label: string;
  /** Tinted background for chips and panels in this band. */
  softColor: string;
}> = {
  high: {color: '#d66963', label: 'สูง', softColor: '#fbe8e5'},
  low: {color: '#618661', label: 'ต่ำ', softColor: '#e2eddf'},
  medium: {color: '#c98a3f', label: 'ปานกลาง', softColor: '#fdf1de'},
};

/** Falls back to the calmest band rather than throwing on an unexpected value. */
export function burnoutRiskBand(level: BurnoutRiskLevel | undefined | null) {
  return (level && BURNOUT_RISK_BANDS[level]) || BURNOUT_RISK_BANDS.low;
}

/**
 * How much of the track the fill covers, as a percentage. A score outside
 * 0-100 is an upstream bug, but it must not render a bar that overflows its
 * track or inverts, so it is clamped rather than trusted.
 */
export function riskMeterFillPercent(score: number) {
  return Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0;
}

/** Neutral track behind the fill, matching the other meters in the app. */
export const RISK_METER_TRACK_COLOR = '#e4e8e2';
