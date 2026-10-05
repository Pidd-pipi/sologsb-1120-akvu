<script setup lang="ts">
import { computed } from 'vue';
import type { ConditionGrade } from '../../types/clock';
import type { StepState } from '../../types/step';

const props = defineProps<{
  /** 角标文案 */
  label?: string;
  /** 品相等级 */
  grade?: ConditionGrade;
  /** 工序状态 */
  state?: StepState;
  /** 磨损/决定等自由角标 */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'primary';
}>();

const type = computed(() => {
  if (props.tone) return props.tone;
  if (props.state) {
    if (props.state === 'done') return 'success';
    if (props.state === 'rolledback') return 'danger';
    return 'info';
  }
  switch (props.grade) {
    case '一级':
      return 'success';
    case '二级':
      return 'primary';
    case '三级':
      return 'warning';
    default:
      return 'danger';
  }
});

const text = computed(() => {
  if (props.label) return props.label;
  if (props.state) {
    if (props.state === 'done') return '已完成';
    if (props.state === 'rolledback') return '已回退';
    return '待办';
  }
  return props.grade ?? '—';
});
</script>

<template>
  <el-tag :type="type" size="small" effect="light">{{ text }}</el-tag>
</template>
