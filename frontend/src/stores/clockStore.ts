import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Clock, ClockDraft, ConditionGrade } from '../types/clock';

interface ClockState {
  items: Clock[];
  loaded: boolean;
}

export const useClockStore = defineStore('clock', {
  state: (): ClockState => ({ items: [], loaded: false }),
  getters: {
    byId: (state) => (id: string) => state.items.find((it) => it.id === id),
    calibers: (state) => Array.from(new Set(state.items.map((it) => it.caliber))).filter(Boolean),
  },
  actions: {
    async load() {
      const rows = await db.clocks.orderBy('createdAt').reverse().toArray();
      this.items = rows;
      this.loaded = true;
    },
    async add(draft: ClockDraft) {
      const record: Clock = { ...toPlain(draft), id: newId('clk'), createdAt: Date.now() };
      await db.clocks.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    async update(id: string, patch: Partial<Clock>) {
      const plain = toPlain(patch);
      await db.clocks.update(id, plain);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    async setGrade(id: string, grade: ConditionGrade) {
      await this.update(id, { conditionGrade: grade });
    },
    async remove(id: string) {
      await db.clocks.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
    },
  },
});
