import { computed, unref, type Ref } from 'vue';
import { useStepStore } from '../stores/stepStore';
import { findSeqGaps } from '../utils/id';
import type { RepairStep } from '../types/step';

export interface RepairProgress {
  steps: RepairStep[];
  total: number;
  done: number;
  rolledback: number;
  percent: number;
  /** 当前卡点步骤 */
  current: RepairStep | undefined;
  /** 顺序号缺口 */
  gaps: number[];
}

/**
 * 统计某台钟表的工序完成比例与当前卡点步骤。
 * 被钟表详情页与工序录入页消费。
 */
export function useRepairProgress(clockId: string | Ref<string>) {
  const stepStore = useStepStore();
  const id = computed(() => unref(clockId));

  const steps = computed(() =>
    stepStore.items.filter((it) => it.clockId === id.value).sort((a, b) => a.seq - b.seq),
  );
  const total = computed(() => steps.value.length);
  const done = computed(() => steps.value.filter((it) => it.state === 'done').length);
  const rolledback = computed(() => steps.value.filter((it) => it.state === 'rolledback').length);
  const percent = computed(() => (total.value === 0 ? 0 : Math.round((done.value / total.value) * 100)));
  const current = computed(() => steps.value.find((it) => it.state !== 'done'));
  const gaps = computed(() => findSeqGaps(steps.value.map((it) => it.seq)));

  const progress = computed<RepairProgress>(() => ({
    steps: steps.value,
    total: total.value,
    done: done.value,
    rolledback: rolledback.value,
    percent: percent.value,
    current: current.value,
    gaps: gaps.value,
  }));

  return { progress, steps, total, done, rolledback, percent, current, gaps };
}
