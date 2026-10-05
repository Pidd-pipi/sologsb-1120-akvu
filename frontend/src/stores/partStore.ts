import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { evaluateLedger, InventoryError, shortageOf } from '../utils/inventory';
import { notifySync } from '../utils/sync';
import { useStepStore } from './stepStore';
import type { MovementPart, MovementPartDraft } from '../types/part';

interface PartState {
  items: MovementPart[];
  loaded: boolean;
}

export class PartConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartConflictError';
  }
}

export const usePartStore = defineStore('part', {
  state: (): PartState => ({ items: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) => state.items.filter((it) => it.clockId === clockId),
    pendingRepair: (state) => state.items.filter((it) => it.decision !== '保留' && it.wearState !== '完好'),
  },
  actions: {
    async load() {
      this.items = await db.parts.toArray();
      this.loaded = true;
    },
    async add(draft: MovementPartDraft) {
      const record: MovementPart = { ...toPlain(draft), id: newId('prt') };
      await db.parts.put(toPlain(record));
      this.items = [...this.items, record];
      notifySync('parts');
      return record;
    },
    /**
     * 修改零件。涉及用量/批号/处理决定/名称时，在事务内重算领用账：
     * 容量不足（含另一页签刚领走）则整笔修改回滚；修改成功后占用随新用量重算。
     */
    async update(id: string, patch: Partial<MovementPart>) {
      const plain = toPlain(patch);
      const affectsLedger =
        'qtyNeeded' in plain ||
        'sourceLot' in plain ||
        'decision' in plain ||
        'name' in plain ||
        'clockId' in plain;

      try {
        await db.transaction('rw', db.parts, db.steps, db.lots, db.clocks, async () => {
          if (affectsLedger) {
            const [parts, steps, lots, clocks] = await Promise.all([
              db.parts.toArray(),
              db.steps.toArray(),
              db.lots.toArray(),
              db.clocks.toArray(),
            ]);
            const current = parts.find((p) => p.id === id);
            if (!current) throw new PartConflictError('零件不存在，可能已被删除');
            const projected: MovementPart = { ...current, ...plain };
            const projectedList = parts.map((p) => (p.id === id ? projected : p));
            const { occupancy, issues } = evaluateLedger({ steps, parts: projectedList, lots, clocks });
            // 只拦截与本次修改直接相关的问题：该零件自身的，或其批号的超占
            const lotNo = projected.sourceLot?.trim() ?? '';
            const partIssues = issues.filter((i) => i.partId === id);
            const lotShortages = shortageOf(occupancy).filter((i) => i.lotNo === lotNo);
            const all = [...partIssues, ...lotShortages];
            const order = ['no-lot', 'lot-missing', 'name-mismatch', 'pending', 'shortage'] as const;
            for (const code of order) {
              const hit = all.find((i) => i.code === code);
              if (hit) throw new InventoryError(hit);
            }
          }
          await db.parts.update(id, plain);
        });
      } catch (err) {
        await this.load();
        throw err;
      }
      await this.load();
      notifySync('parts');
    },
    async remove(id: string) {
      const part = this.items.find((it) => it.id === id);
      await db.transaction('rw', db.parts, db.steps, async () => {
        const steps = await db.steps.toArray();
        const usedByDoneAssembly = steps.some(
          (s) => s.state === 'done' && s.stepType === '装配' && s.partIds.includes(id),
        );
        if (usedByDoneAssembly) {
          throw new PartConflictError(
            `零件「${part?.name ?? ''}」已被已完成的装配工序领用，不能删除；请先回退该装配工序`,
          );
        }
        await db.parts.delete(id);
        // 同步摘掉未完成工序上的关联，避免悬挂引用
        for (const s of steps) {
          if (s.partIds.includes(id)) {
            await db.steps.update(s.id, { partIds: s.partIds.filter((pid) => pid !== id) });
          }
        }
      });
      this.items = this.items.filter((it) => it.id !== id);
      // 同步本页签工序内存，其他页签由 notifySync 重拉
      const stepStore = useStepStore();
      stepStore.items = stepStore.items.map((s) =>
        s.partIds.includes(id) ? { ...s, partIds: s.partIds.filter((pid) => pid !== id) } : s,
      );
      notifySync('parts');
    },
  },
});
