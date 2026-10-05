import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Claim, Stock } from '../types/stock';
import { LedgerError } from '../types/stock';
import type { MovementPart } from '../types/part';
import { needsRepair } from '../types/part';
import type { RepairStep } from '../types/step';

interface StockState {
  stocks: Stock[];
  claims: Claim[];
  loaded: boolean;
}

/** 零件是否需要按来源批号领用：保留/完好不领用，其余按 qtyNeeded 占用 */
function needsClaim(part: MovementPart): boolean {
  return needsRepair(part);
}

function occupiedOf(claims: Claim[], lot: string): number {
  return claims.filter((c) => c.lot === lot).reduce((sum, c) => sum + c.qty, 0);
}

export const useStockStore = defineStore('stock', {
  state: (): StockState => ({ stocks: [], claims: [], loaded: false }),
  getters: {
    /** 批号 → 可用数量（入库总数 - 已占用） */
    availableByLot: (state) => {
      const map: Record<string, number> = {};
      for (const s of state.stocks) {
        map[s.lot] = s.qtyTotal - occupiedOf(state.claims, s.lot);
      }
      return map;
    },
    /** 批号 → 已占用数量 */
    occupiedByLot: (state) => {
      const map: Record<string, number> = {};
      for (const c of state.claims) {
        map[c.lot] = (map[c.lot] ?? 0) + c.qty;
      }
      return map;
    },
    stockByLot: (state) => (lot: string) => state.stocks.find((s) => s.lot === lot),
  },
  actions: {
    async load() {
      const [stocks, claims] = await Promise.all([db.stocks.toArray(), db.claims.toArray()]);
      this.stocks = stocks;
      this.claims = claims;
      this.loaded = true;
    },

    /**
     * 完成工序前按实际用量占用批号数量。
     * 整个「查库存 → 占用 → 改工序状态」在同一个 rw 事务里，
     * IndexedDB 会把并发页签的事务串行化：后提交的事务能读到先提交的占用，
     * 因此两个页签同时提交最后一枚时只有一个能保存。
     * 待核批号拒绝领用；容量不足抛 LedgerError 并指出还差多少；事务回滚。
     * 返回 false 表示该工序已被其他页签完成（幂等，不重复占用）。
     */
    async occupyStep(stepId: string): Promise<boolean> {
      return await db.transaction('rw', db.steps, db.parts, db.stocks, db.claims, async () => {
        const step = await db.steps.get(stepId);
        if (!step) throw new LedgerError('工序不存在');
        if (step.state === 'done') return false;

        const partIds = step.partIds ?? [];
        const parts = await db.parts.where('id').anyOf(partIds).toArray();

        for (const part of parts) {
          if (!needsClaim(part)) continue;
          const lot = (part.sourceLot ?? '').trim();
          if (!lot) {
            throw new LedgerError(`零件「${part.name}」未登记来源批号，无法领用`);
          }
          const qty = part.qtyNeeded;
          // 缺库存记录时按已用量回填待核（懒回填，与 v3 升级口径一致）
          let stock = await db.stocks.where('lot').equals(lot).first();
          if (!stock) stock = await this.backfillLot(lot);
          if (stock.status === 'pending') {
            throw new LedgerError(`批号「${lot}」待核，请先入库或核销后再领用`);
          }
          const lotClaims = await db.claims.where('lot').equals(lot).toArray();
          const occupied = lotClaims.reduce((sum, c) => sum + c.qty, 0);
          const available = stock.qtyTotal - occupied;
          if (available < qty) {
            throw new LedgerError(
              `批号「${lot}」库存不足：需 ${qty}，可用 ${available}，还差 ${qty - available}`,
            );
          }
          // 逐笔落账，保证同工序多零件共用批号时后续判断能读到已占用量
          await db.claims.put(
            toPlain({
              id: newId('clm'),
              lot,
              partId: part.id,
              stepId: step.id,
              clockId: step.clockId,
              qty,
              claimedAt: Date.now(),
            } satisfies Claim),
          );
        }

        await db.steps.update(stepId, { state: 'done', finishedAt: Date.now() });
        return true;
      });
    },

    /** 回退工序：释放该工序已占用的全部数量，进度重算 */
    async releaseStep(stepId: string): Promise<void> {
      await db.transaction('rw', db.steps, db.claims, async () => {
        const step = await db.steps.get(stepId);
        if (!step || step.state !== 'done') return;
        await db.claims.where('stepId').equals(stepId).delete();
        await db.steps.update(stepId, { state: 'rolledback', finishedAt: undefined });
      });
    },

    /**
     * 修改零件用量/批号/处理决定后，重建该零件在所有已完成工序上的领用账：
     * 先释放旧占用，再按新用量重新占用；待核批号或容量不足则整笔回滚。
     * 需在调用方的 rw 事务内执行（与零件更新同事务）。
     */
    async rebuildPartClaims(partId: string): Promise<void> {
      const part = await db.parts.get(partId);
      if (!part) return;

      const existing = await db.claims.where('partId').equals(partId).toArray();
      if (existing.length === 0) return;

      // 释放旧占用
      await db.claims.bulkDelete(existing.map((c) => c.id));

      // 保留/完好不再领用，释放即可
      if (!needsClaim(part)) return;

      const lot = (part.sourceLot ?? '').trim();
      if (!lot) {
        throw new LedgerError(`零件「${part.name}」未登记来源批号，无法领用`);
      }

      // 该零件参与的已完成工序（按工序流重建领用账）
      const doneSteps = await db.steps.where('state').equals('done').toArray();
      const stepsForPart = doneSteps.filter((s) => (s.partIds ?? []).includes(partId));

      for (const step of stepsForPart) {
        let stock = await db.stocks.where('lot').equals(lot).first();
        if (!stock) stock = await this.backfillLot(lot);
        if (stock.status === 'pending') {
          throw new LedgerError(`批号「${lot}」待核，请先入库或核销后再领用`);
        }
        const lotClaims = await db.claims.where('lot').equals(lot).toArray();
        const occupied = lotClaims.reduce((sum, c) => sum + c.qty, 0);
        const available = stock.qtyTotal - occupied;
        if (available < part.qtyNeeded) {
          throw new LedgerError(
            `批号「${lot}」库存不足：需 ${part.qtyNeeded}，可用 ${available}，还差 ${
              part.qtyNeeded - available
            }`,
          );
        }
        await db.claims.put(
          toPlain({
            id: newId('clm'),
            lot,
            partId: part.id,
            stepId: step.id,
            clockId: step.clockId,
            qty: part.qtyNeeded,
            claimedAt: Date.now(),
          } satisfies Claim),
        );
      }
    },

    /** 批号入库：追加入库总数；待核批号入库后视为已核销，可正常领用 */
    async addStock(lot: string, qty: number): Promise<void> {
      const key = lot.trim();
      if (!key) throw new LedgerError('批号必填');
      if (!Number.isFinite(qty) || qty <= 0) throw new LedgerError('入库数量必须为正整数');
      await db.transaction('rw', db.stocks, async () => {
        const stock = await db.stocks.where('lot').equals(key).first();
        if (stock) {
          await db.stocks.update(stock.id, {
            qtyTotal: stock.qtyTotal + qty,
            status: 'normal',
            note: '',
          });
        } else {
          await db.stocks.put(
            toPlain({
              id: newId('stk'),
              lot: key,
              qtyTotal: qty,
              status: 'normal',
              note: '',
            } satisfies Stock),
          );
        }
      });
      await this.load();
    },

    /** 待核批号核销为正常（确认入库总数无误） */
    async verifyStock(lot: string): Promise<void> {
      const stock = await db.stocks.where('lot').equals(lot).first();
      if (!stock || stock.status !== 'pending') return;
      await db.stocks.update(stock.id, { status: 'normal', note: '' });
      await this.load();
    },

    /**
     * 旧数据缺库存记录时按已用量回填待核：
     * 入库总数 = 已完成工序中引用该批号零件的 qtyNeeded 合计，状态 pending。
     * 待核批号不可直接领用（需入库或核销），不把无来源旧记录当成可用。
     */
    async backfillLot(lot: string): Promise<Stock> {
      const key = lot.trim();
      const allParts = await db.parts.toArray();
      const lotParts = allParts.filter((p) => (p.sourceLot ?? '').trim() === key);
      const doneSteps = await db.steps.where('state').equals('done').toArray();
      const referenced = new Set<string>();
      for (const s of doneSteps) for (const pid of s.partIds ?? []) referenced.add(pid);

      const usedQty = lotParts
        .filter((p) => referenced.has(p.id))
        .reduce((sum, p) => sum + p.qtyNeeded, 0);

      const existing = await db.stocks.where('lot').equals(key).first();
      if (existing) return existing;

      const stock: Stock = {
        id: newId('stk'),
        lot: key,
        qtyTotal: usedQty,
        status: 'pending',
        note: '旧数据回填，待核',
      };
      await db.stocks.put(toPlain(stock));
      return stock;
    },
  },
});
