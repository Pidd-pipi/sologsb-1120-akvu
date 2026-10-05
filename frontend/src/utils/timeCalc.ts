import type { PositionReading } from '../types/test';

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 日差 s/d → s/月（按 30 天） */
export function ratePerDayToMonth(rate: number): number {
  return round(rate * 30, 1);
}

/** 日差 s/d → 每日秒数误差描述 */
export function rateLabel(rate: number): string {
  if (rate === 0) return '走时精准';
  return rate > 0 ? `每日快 ${round(rate, 1)} 秒` : `每日慢 ${round(Math.abs(rate), 1)} 秒`;
}

/** 多方位日差均值 */
export function avgRate(readings: PositionReading[]): number {
  if (readings.length === 0) return 0;
  return round(readings.reduce((sum, r) => sum + r.rate, 0) / readings.length, 2);
}

/** 多方位摆幅均值 */
export function avgAmplitude(readings: PositionReading[]): number {
  if (readings.length === 0) return 0;
  return round(readings.reduce((sum, r) => sum + r.amplitude, 0) / readings.length, 1);
}

/** 多方位偏振均值 */
export function avgBeatError(readings: PositionReading[]): number {
  if (readings.length === 0) return 0;
  return round(readings.reduce((sum, r) => sum + r.beatError, 0) / readings.length, 2);
}

/** 摆幅分级 */
export function amplitudeLevel(amplitude: number): { label: string; type: 'success' | 'warning' | 'danger' } {
  if (amplitude >= 270) return { label: '摆幅健康', type: 'success' };
  if (amplitude >= 230) return { label: '摆幅偏低', type: 'warning' };
  return { label: '摆幅不足', type: 'danger' };
}

/** 偏振分级 */
export function beatErrorLevel(beatError: number): { label: string; type: 'success' | 'warning' | 'danger' } {
  if (beatError <= 0.5) return { label: '偏振良好', type: 'success' };
  if (beatError <= 1.0) return { label: '偏振可接受', type: 'warning' };
  return { label: '偏振偏大', type: 'danger' };
}

/** 秒 → 时分文案 */
export function secondsToText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} 分 ${s} 秒`;
}
