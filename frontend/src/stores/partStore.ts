import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { MovementPart, MovementPartDraft } from '../types/part';

interface PartState {
  items: MovementPart[];
  loaded: boolean;
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
      return record;
    },
    async update(id: string, patch: Partial<MovementPart>) {
      const plain = toPlain(patch);
      await db.parts.update(id, plain);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    async remove(id: string) {
      await db.parts.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
    },
  },
});
