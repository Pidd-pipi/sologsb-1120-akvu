import type { Clock } from '../types/clock';
import type { PartLot } from '../types/lot';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';

/**
 * 零件-工序-钟表领用账核心规则。
 *
 * 账不是一张独立表，而是从「已完成的装配工序」实时派生：
 *  - 仅 stepType === '装配' 且 state === 'done' 的工序产生占用；
 *  - 仅 decision !== '保留' 的配换零件需要领用来源批号；
 *  - 同一零件可能挂在多道工序上，按 partId 去重，只在装配完成时记一次实际用量；
 *  - 回退装配工序即释放占用；修改零件用量/批号后，账随下次校验自动重算。
 */

/** 库存校验问题码 */
export type InventoryIssueCode = 'no-lot' | 'lot-missing' | 'name-mismatch' | 'pending' | 'shortage';

export interface InventoryIssue {
  code: InventoryIssueCode;
  /** 受影响的零件 id（shortage 跨多零件时为空） */
  partId: string;
  /** 受影响的钟表编号（无钟表时为空） */
  clockNo: string;
  partName: string;
  lotNo: string;
  /** shortage 时：本批号还需释放/补登的件数 */
  short: number;
  message: string;
}

/** 库存校验失败：容量不足等拒绝场景抛出 */
export class InventoryError extends Error {
  issues: InventoryIssue[];
  constructor(issue: InventoryIssue) {
    super(issue.message);
    this.name = 'InventoryError';
    this.issues = [issue];
  }
}

/** 是否属于需要领用来源批号的配换零件（保留件、完好旧件不领用） */
export function requiresLot(part: MovementPart): boolean {
  return part.decision !== '保留';
}

/** 一条已发生的领用记录（派生账的一行） */
export interface LedgerEntry {
  part: MovementPart;
  step: RepairStep;
  clock?: Clock;
  lot: PartLot;
  qty: number;
}

/** 某批号下的占用汇总 */
export interface LotOccupancy {
  lot: PartLot;
  occupied: number;
  entries: LedgerEntry[];
}

interface LedgerInput {
  steps: RepairStep[];
  parts: MovementPart[];
  lots: PartLot[];
  clocks?: Clock[];
  /** 只统计指定工序完成后的增量（完成装配时用于容量校验） */
  includeStepIds?: string[];
}

/**
 * 计算各批号的实际占用，同时收集无批号/无库存/待核等问题。
 * 返回的 issues 不含 shortage（shortage 由 shortageOf 基于容量计算）。
 */
export function evaluateLedger(input: LedgerInput): {
  occupancy: Map<string, LotOccupancy>;
  issues: InventoryIssue[];
  entries: LedgerEntry[];
} {
  const { steps, parts, lots, clocks = [] } = input;
  const partById = new Map(parts.map((p) => [p.id, p]));
  const lotByNo = new Map(lots.map((l) => [l.lotNo, l]));
  const clockById = new Map(clocks.map((c) => [c.id, c]));

  // 只统计已完成的装配工序；includeStepIds 给定时，把指定（尚未落库的）工序也算进来
  const scopedStepIds = input.includeStepIds ? new Set(input.includeStepIds) : null;
  const assemblySteps = steps.filter(
    (s) => (s.state === 'done' && s.stepType === '装配') || scopedStepIds?.has(s.id),
  );

  // 同一零件最多记一次领用（防止同一批号在多道工序里被重复算）
  const consumedPart = new Set<string>();
  const occupancy = new Map<string, LotOccupancy>();
  const entries: LedgerEntry[] = [];
  const issues: InventoryIssue[] = [];

  for (const step of assemblySteps) {
    for (const partId of step.partIds) {
      const part = partById.get(partId);
      if (!part || !requiresLot(part) || consumedPart.has(part.id)) continue;
      consumedPart.add(part.id);

      const clock = clockById.get(part.clockId);
      const clockNo = clock?.clockNo ?? '';
      const lotNo = part.sourceLot?.trim() ?? '';

      if (!lotNo) {
        issues.push({
          code: 'no-lot',
          partId: part.id,
          clockNo,
          partName: part.name,
          lotNo: '',
          short: 0,
          message: `${clockPrefix(clockNo)}配换零件「${part.name}」未登记来源批号，不能当作有库存领用`,
        });
        continue;
      }
      const lot = lotByNo.get(lotNo);
      if (!lot) {
        issues.push({
          code: 'lot-missing',
          partId: part.id,
          clockNo,
          partName: part.name,
          lotNo,
          short: 0,
          message: `${clockPrefix(clockNo)}「${part.name}」引用的批号 ${lotNo} 没有库存记录，请先登记或核对`,
        });
        continue;
      }
      if (lot.partName !== part.name) {
        issues.push({
          code: 'name-mismatch',
          partId: part.id,
          clockNo,
          partName: part.name,
          lotNo,
          short: 0,
          message: `${clockPrefix(clockNo)}批号 ${lotNo} 登记的是「${lot.partName}」，与领用零件「${part.name}」不符`,
        });
        continue;
      }

      const entry: LedgerEntry = {
        part,
        step,
        clock,
        lot,
        qty: part.qtyNeeded,
      };
      entries.push(entry);
      const agg =
        occupancy.get(lot.lotNo) ??
        ({ lot, occupied: 0, entries: [] } as LotOccupancy);
      agg.occupied += part.qtyNeeded;
      agg.entries.push(entry);
      occupancy.set(lot.lotNo, agg);

      if (lot.status === 'pending') {
        issues.push({
          code: 'pending',
          partId: part.id,
          clockNo,
          partName: part.name,
          lotNo,
          short: 0,
          message: `批号 ${lotNo}（${part.name}）是旧数据回填的待核库存，核账前不能继续领用`,
        });
      }
    }
  }

  return { occupancy, issues, entries };
}

/** 在占用汇总上叠加容量校验，返回所有超占批号「还差多少件」 */
export function shortageOf(occupancy: Map<string, LotOccupancy>): InventoryIssue[] {
  const issues: InventoryIssue[] = [];
  for (const agg of occupancy.values()) {
    if (agg.occupied <= agg.lot.capacity) continue;
    const short = agg.occupied - agg.lot.capacity;
    const consumers = agg.entries.map((e) => e.clock?.clockNo).filter(Boolean);
    const where = consumers.length ? `（涉及 ${Array.from(new Set(consumers)).join('、')}）` : '';
    issues.push({
      code: 'shortage',
      partId: '',
      clockNo: '',
      partName: agg.lot.partName,
      lotNo: agg.lot.lotNo,
      short,
      message: `批号 ${agg.lot.lotNo}（${agg.lot.partName}）容量 ${agg.lot.capacity} 件，已领用 ${agg.occupied} 件${where}，还差 ${short} 件`,
    });
  }
  return issues;
}

/**
 * 完成装配前的完整校验。返回第一个需要拒绝的问题。
 * includeStep：把待完成的那道工序当作已完成计算（它可能还没落库为 done）。
 */
export function checkAssemblyFinish(input: {
  step: RepairStep;
  steps: RepairStep[];
  parts: MovementPart[];
  lots: PartLot[];
  clocks?: Clock[];
}): InventoryIssue | null {
  const { occupancy, issues } = evaluateLedger({
    steps: input.steps,
    parts: input.parts,
    lots: input.lots,
    clocks: input.clocks,
    includeStepIds: [input.step.id],
  });
  const shortage = shortageOf(occupancy);
  const order: InventoryIssueCode[] = ['no-lot', 'lot-missing', 'name-mismatch', 'pending', 'shortage'];
  const all = [...issues, ...shortage];
  for (const code of order) {
    const hit = all.find((i) => i.code === code);
    if (hit) return hit;
  }
  return null;
}

/** 台账视图：按批号分组的占用 + 全部问题（供领用账页展示） */
export function buildLedgerView(input: Omit<LedgerInput, 'includeStepIds'>) {
  const { occupancy, entries } = evaluateLedger(input);
  const rows = Array.from(occupancy.values())
    .map((agg) => ({
      lot: agg.lot,
      occupied: agg.occupied,
      remaining: agg.lot.capacity - agg.occupied,
      entries: agg.entries,
    }))
    .sort((a, b) => a.lot.lotNo.localeCompare(b.lot.lotNo, 'zh-Hans-CN'));
  return { rows, entries };
}

function clockPrefix(clockNo: string): string {
  return clockNo ? `「${clockNo}」` : '';
}
