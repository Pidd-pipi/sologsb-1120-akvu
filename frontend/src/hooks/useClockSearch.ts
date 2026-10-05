import { computed, ref } from 'vue';
import { useClockStore } from '../stores/clockStore';
import type { Clock } from '../types/clock';

export type ClockSortKey = 'createdAt' | 'clockNo' | 'yearMade';

export interface ClockFilters {
  keyword: string;
  kind: string;
  caliber: string;
  grade: string;
  yearFrom: string;
  yearTo: string;
  sortBy: ClockSortKey;
}

export const DEFAULT_CLOCK_FILTERS: ClockFilters = {
  keyword: '',
  kind: 'all',
  caliber: 'all',
  grade: 'all',
  yearFrom: '',
  yearTo: '',
  sortBy: 'createdAt',
};

/**
 * 按种类、机芯型号、年代区间、品相多条件过滤排序。
 * 被钟表台账（/clocks）与钟表详情页消费。
 */
export function useClockSearch(initial?: Partial<ClockFilters>) {
  const store = useClockStore();
  const filters = ref<ClockFilters>({ ...DEFAULT_CLOCK_FILTERS, ...initial });

  const options = computed(() => ({
    kinds: Array.from(new Set(store.items.map((it) => it.kind))).filter(Boolean),
    calibers: Array.from(new Set(store.items.map((it) => it.caliber))).filter(Boolean),
    grades: Array.from(new Set(store.items.map((it) => it.conditionGrade))).filter(Boolean),
  }));

  const result = computed<Clock[]>(() => {
    const f = filters.value;
    const kw = f.keyword.trim().toLowerCase();
    const from = f.yearFrom ? Number(f.yearFrom) : undefined;
    const to = f.yearTo ? Number(f.yearTo) : undefined;
    const rows = store.items.filter((it) => {
      if (kw) {
        const hit =
          it.clockNo.toLowerCase().includes(kw) ||
          it.caliber.toLowerCase().includes(kw) ||
          it.maker.toLowerCase().includes(kw) ||
          it.dialMark.toLowerCase().includes(kw);
        if (!hit) return false;
      }
      if (f.kind !== 'all' && it.kind !== f.kind) return false;
      if (f.caliber !== 'all' && it.caliber !== f.caliber) return false;
      if (f.grade !== 'all' && it.conditionGrade !== f.grade) return false;
      const year = Number(String(it.yearMade).replace(/[^0-9]/g, '')) || 0;
      if (from !== undefined && Number.isFinite(from) && year < from) return false;
      if (to !== undefined && Number.isFinite(to) && year > to) return false;
      return true;
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (f.sortBy === 'clockNo') return a.clockNo.localeCompare(b.clockNo);
      if (f.sortBy === 'yearMade') {
        const ya = Number(String(a.yearMade).replace(/[^0-9]/g, '')) || 0;
        const yb = Number(String(b.yearMade).replace(/[^0-9]/g, '')) || 0;
        return ya - yb;
      }
      return b.createdAt - a.createdAt;
    });
    return sorted;
  });

  function reset() {
    filters.value = { ...DEFAULT_CLOCK_FILTERS };
  }

  return { filters, result, options, reset, store };
}
