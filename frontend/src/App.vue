<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { readDbVersion } from './utils/db';
import { onSyncChange } from './utils/sync';
import { useClockStore } from './stores/clockStore';
import { usePartStore } from './stores/partStore';
import { useStepStore } from './stores/stepStore';
import { useLotStore } from './stores/lotStore';

const route = useRoute();
const router = useRouter();

const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const lotStore = useLotStore();

const activeMenu = computed(() => {
  if (route.path.startsWith('/clocks')) return '/clocks';
  if (route.path.startsWith('/steps')) return '/steps/new';
  if (route.path.startsWith('/parts')) return '/parts';
  if (route.path.startsWith('/tests')) return '/tests';
  return '/clocks';
});

const version = readDbVersion();

// 其他页签提交后重拉数据：抢最后一枚失败的一方立即看到真实余量
let offSync: (() => void) | null = null;
onMounted(() => {
  offSync = onSyncChange(() => {
    void clockStore.load();
    void partStore.load();
    void stepStore.load();
    void lotStore.load();
  });
});
onUnmounted(() => offSync?.());

function onSelect(index: string) {
  if (index === '/tests') {
    void router.push('/tests/');
    return;
  }
  void router.push(index);
}
</script>

<template>
  <el-container class="app">
    <el-header class="app-header">
      <div class="brand">古钟表维修工序档案</div>
      <el-menu :default-active="activeMenu" mode="horizontal" class="menu" @select="onSelect">
        <el-menu-item index="/clocks">钟表台账</el-menu-item>
        <el-menu-item index="/steps/new">工序录入</el-menu-item>
        <el-menu-item index="/parts">零件清单</el-menu-item>
        <el-menu-item index="/tests">走时测试</el-menu-item>
      </el-menu>
      <el-tag size="small" effect="plain">本地结构版本 v{{ version }}</el-tag>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f6f8fa;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 18px;
  background: #2f3a46;
  color: #f4f6f8;
  height: 60px;
}
.brand {
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}
.menu {
  flex: 1;
  border-bottom: none;
  background: transparent;
}
:deep(.menu .el-menu-item) {
  color: #d6dde5;
}
:deep(.menu .el-menu-item.is-active) {
  color: #ffffff;
  border-bottom-color: #e7c56b;
}
.app-main {
  padding: 18px 22px 40px;
}
</style>
