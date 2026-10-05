import { computed } from 'vue';
import { useClockStore } from '../stores/clockStore';
import { useLotStore, type LotLedgerRow } from '../stores/lotStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { evaluateLedger, shortageOf, type InventoryIssue } from '../utils/inventory';

/**
 * 领用账全局视图：基于已完成的装配工序实时派生。
 * 回退装配、修改零件用量/批号后，占用与剩余自动重算。
 */
export function useLedger() {
  const clockStore = useClockStore();
  const partStore = usePartStore();
  const stepStore = useStepStore();
  const lotStore = useLotStore();

  const rows = computed<LotLedgerRow[]>(() =>
    lotStore.ledger(stepStore.items, partStore.items, clockStore.items),
  );

  /** 当前全部库存问题（无批号、无库存记录、名称不符、待核批号、容量不足） */
  const issues = computed<InventoryIssue[]>(() => {
    const { occupancy, issues: base } = evaluateLedger({
      steps: stepStore.items,
      parts: partStore.items,
      lots: lotStore.items,
      clocks: clockStore.items,
    });
    const order = ['no-lot', 'lot-missing', 'name-mismatch', 'pending', 'shortage'] as const;
    const all = [...base, ...shortageOf(occupancy)];
    return order.flatMap((code) => all.filter((i) => i.code === code));
  });

  /** 某台钟表在已完成装配中，某批号被占用的件数 */
  function occupiedByClock(clockId: string): Map<string, number> {
    const result = new Map<string, number>();
    for (const row of rows.value) {
      const qty = row.entries
        .filter((e) => e.part.clockId === clockId)
        .reduce((sum, e) => sum + e.qty, 0);
      if (qty > 0) result.set(row.lot.lotNo, qty);
    }
    return result;
  }

  return { rows, issues, occupiedByClock };
}
