import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { useStockStore } from './stockStore';
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
    /**
     * 修改用量/批号/处理决定后，同步重建该零件已占用的领用账：
     * 释放旧占用并按新用量重新占用，容量不足则整笔回滚并抛出。
     */
    async update(id: string, patch: Partial<MovementPart>) {
      const plain = toPlain(patch);
      const ledgerTouched =
        patch.qtyNeeded !== undefined ||
        patch.sourceLot !== undefined ||
        patch.decision !== undefined ||
        patch.wearState !== undefined;
      if (ledgerTouched) {
        await db.transaction('rw', db.parts, db.claims, db.stocks, db.steps, async () => {
          await db.parts.update(id, plain);
          await useStockStore().rebuildPartClaims(id);
        });
        await useStockStore().load();
      } else {
        await db.parts.update(id, plain);
      }
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    async remove(id: string) {
      await db.parts.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
    },
  },
});
