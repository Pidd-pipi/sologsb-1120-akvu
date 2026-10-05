import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { buildLedgerView } from '../utils/inventory';
import { notifySync } from '../utils/sync';
import type { PartLot, PartLotDraft } from '../types/lot';
import type { Clock } from '../types/clock';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';

export interface LotLedgerRow {
  lot: PartLot;
  occupied: number;
  remaining: number;
  entries: Array<{
    part: MovementPart;
    step: RepairStep;
    clock?: Clock;
    qty: number;
  }>;
}

interface LotState {
  items: PartLot[];
  loaded: boolean;
}

export class LotConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LotConflictError';
  }
}

export const useLotStore = defineStore('lot', {
  state: (): LotState => ({ items: [], loaded: false }),
  getters: {
    byNo: (state) => (lotNo: string) =>
      state.items.find((it) => it.lotNo === lotNo.trim()),
  },
  actions: {
    async load() {
      this.items = await db.lots.toArray();
      this.loaded = true;
    },
    async add(draft: PartLotDraft) {
      const lotNo = draft.lotNo.trim();
      if (!lotNo) throw new LotConflictError('批号不能为空');
      if (this.items.some((it) => it.lotNo === lotNo)) {
        throw new LotConflictError(`批号 ${lotNo} 已存在，请直接核账或调整容量`);
      }
      const record: PartLot = {
        ...toPlain(draft),
        lotNo,
        id: newId('lot'),
        createdAt: Date.now(),
      };
      await db.lots.put(toPlain(record));
      this.items = [...this.items, record];
      notifySync('lots');
      return record;
    },
    async update(id: string, patch: Partial<PartLot>) {
      const plain = toPlain(patch);
      await db.lots.update(id, plain);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
      notifySync('lots');
    },
    /** 核账：待核批号转为在册，可一并校正容量 */
    async verify(id: string, capacity?: number) {
      const lot = this.items.find((it) => it.id === id);
      if (!lot) return;
      const patch: Partial<PartLot> = {
        status: 'verified',
        verifiedAt: Date.now(),
        note: '已核账入库',
        ...(capacity !== undefined ? { capacity } : {}),
      };
      await db.lots.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
      notifySync('lots');
    },
    async remove(id: string) {
      await db.lots.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
      notifySync('lots');
    },
    /** 派生领用账：按批号汇总占用（参数由 part/step/clock store 提供，避免循环依赖） */
    ledger(steps: RepairStep[], parts: MovementPart[], clocks: Clock[]): LotLedgerRow[] {
      return buildLedgerView({ steps, parts, lots: this.items, clocks }).rows;
    },
  },
});
