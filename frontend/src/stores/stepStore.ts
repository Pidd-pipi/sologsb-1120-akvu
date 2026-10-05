import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { checkAssemblyFinish, InventoryError } from '../utils/inventory';
import { notifySync } from '../utils/sync';
import type { RepairStep, RepairStepDraft } from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

export class StepConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepConflictError';
  }
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests.filter((it) => it.clockId === clockId).sort((a, b) => b.testedAt - a.testedAt),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.loaded = true;
    },
    async add(draft: RepairStepDraft) {
      const record: RepairStep = { ...toPlain(draft), id: newId('stp') };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      notifySync('steps');
      return record;
    },
    /**
     * 完成工序。装配工序在同一个 IndexedDB 读写事务里做容量校验：
     * 两个页签同时点完成最后一枚时，事务串行提交，后提交的一方因容量不足整体回滚。
     */
    async finish(id: string) {
      try {
        await db.transaction('rw', db.steps, db.parts, db.lots, db.clocks, async () => {
          const step = await db.steps.get(id);
          if (!step) throw new StepConflictError('工序不存在，可能已被删除');
          if (step.state === 'done') {
            throw new StepConflictError('该工序已在其他页签完成，请刷新后查看最新库存');
          }
          if (step.stepType === '装配') {
            const [steps, parts, lots, clocks] = await Promise.all([
              db.steps.toArray(),
              db.parts.toArray(),
              db.lots.toArray(),
              db.clocks.toArray(),
            ]);
            const issue = checkAssemblyFinish({ step, steps, parts, lots, clocks });
            if (issue) throw new InventoryError(issue);
          }
          const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
          await db.steps.update(id, patch);
        });
      } catch (err) {
        // 失败也要重拉：另一页签可能已提交，本地余量是旧值
        await this.load();
        throw err;
      }
      await this.load();
      notifySync('steps');
    },
    /** 回退工序：装配回退后其占用的批号数量自动释放（占用由已完成装配派生） */
    async rollback(id: string) {
      await db.transaction('rw', db.steps, async () => {
        const step = await db.steps.get(id);
        if (!step) throw new StepConflictError('工序不存在，可能已被删除');
        if (step.state !== 'done') {
          throw new StepConflictError('只有已完成的工序才能回退');
        }
        const patch: Partial<RepairStep> = { state: 'rolledback', finishedAt: undefined };
        await db.steps.update(id, patch);
      });
      await this.load();
      notifySync('steps');
    },
    /** 上下移动排序：交换两个相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      const aSeq = a.seq;
      await db.steps.update(a.id, { seq: b.seq });
      await db.steps.update(b.id, { seq: aSeq });
      this.items = this.items.map((it) => {
        if (it.id === a.id) return { ...it, seq: b.seq };
        if (it.id === b.id) return { ...it, seq: aSeq };
        return it;
      });
      notifySync('steps');
    },
    async addTest(draft: TimekeepingTestDraft) {
      const record: TimekeepingTest = { ...toPlain(draft), id: newId('tst') };
      await db.tests.put(toPlain(record));
      this.tests = [record, ...this.tests];
      notifySync('tests');
      return record;
    },
    async removeTest(id: string) {
      await db.tests.delete(id);
      this.tests = this.tests.filter((it) => it.id !== id);
      notifySync('tests');
    },
  },
});
