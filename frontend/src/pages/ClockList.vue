<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { useStepStore } from '../stores/stepStore';
import { useClockSearch } from '../hooks/useClockSearch';
import ClockCard from '../components/common/ClockCard.vue';
import { CLOCK_KINDS, CONDITION_GRADES, type ClockDraft, type ClockKind, type ConditionGrade } from '../types/clock';

const router = useRouter();
const clockStore = useClockStore();
const stepStore = useStepStore();
const { filters, result, options, reset } = useClockSearch();

const REPAIR_STATES = ['未开工', '维修中', '待测试', '已完成'] as const;

type RepairState = (typeof REPAIR_STATES)[number];

/** 由工序与走时测试推导修复状态，用于台账分栏 */
function repairStateOf(clockId: string): RepairState {
  const steps = stepStore.items.filter((s) => s.clockId === clockId);
  const tests = stepStore.tests.filter((t) => t.clockId === clockId);
  const done = steps.filter((s) => s.state === 'done').length;
  if (steps.length === 0) return '未开工';
  if (done === steps.length && tests.length > 0) return '已完成';
  if (done === steps.length) return '待测试';
  if (done > 0) return '维修中';
  return '未开工';
}

const columns = computed(() =>
  REPAIR_STATES.map((state) => ({
    state,
    rows: result.value.filter((it) => repairStateOf(it.id) === state),
  })),
);

const dialogVisible = ref(false);
const form = reactive<ClockDraft>({
  clockNo: '',
  kind: '座钟',
  caliber: '',
  origin: '',
  maker: '',
  yearMade: '',
  caseMaterial: '',
  size: '300×200×150',
  dialMark: '',
  acquireFrom: '',
  conditionGrade: '待修',
  storagePos: '',
});
const formError = ref('');

function openDialog() {
  dialogVisible.value = true;
  formError.value = '';
}

async function submit() {
  if (!form.clockNo.trim()) {
    formError.value = '藏品号必填';
    return;
  }
  if (clockStore.items.some((it) => it.clockNo === form.clockNo.trim())) {
    formError.value = '藏品号已存在，请更换';
    return;
  }
  const created = await clockStore.add({ ...form, clockNo: form.clockNo.trim() });
  dialogVisible.value = false;
  ElMessage.success(`已建档「${created.clockNo}」`);
  form.clockNo = '';
  form.caliber = '';
  form.maker = '';
  form.dialMark = '';
}

onMounted(() => {
  void clockStore.load();
  void stepStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表台账</h2>
      <el-tag>共 {{ clockStore.items.length }} 台</el-tag>
      <el-tag type="info" effect="plain">筛选命中 {{ result.length }} 台</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openDialog">建档</el-button>
    </div>

    <el-card shadow="never" class="filters">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="藏品号/机芯">
          <el-input v-model="filters.keyword" placeholder="如 CLK-1932 / W278" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item label="种类">
          <el-select v-model="filters.kind" style="width: 130px">
            <el-option label="全部" value="all" />
            <el-option v-for="k in options.kinds" :key="k" :label="k" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="机芯型号">
          <el-select v-model="filters.caliber" style="width: 170px">
            <el-option label="全部" value="all" />
            <el-option v-for="c in options.calibers" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="品相">
          <el-select v-model="filters.grade" style="width: 130px">
            <el-option label="全部" value="all" />
            <el-option v-for="g in CONDITION_GRADES" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="年代区间">
          <el-input v-model="filters.yearFrom" placeholder="起" style="width: 90px" />
          <span style="margin: 0 6px">—</span>
          <el-input v-model="filters.yearTo" placeholder="止" style="width: 90px" />
        </el-form-item>
        <el-form-item label="排序">
          <el-select v-model="filters.sortBy" style="width: 140px">
            <el-option label="按建档时间" value="createdAt" />
            <el-option label="按藏品号" value="clockNo" />
            <el-option label="按年代" value="yearMade" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="board">
      <div v-for="col in columns" :key="col.state" class="column">
        <div class="column-title">
          <strong>{{ col.state }}</strong>
          <el-tag size="small" type="info">{{ col.rows.length }}</el-tag>
        </div>
        <ClockCard
          v-for="item in col.rows"
          :key="item.id"
          :item="item"
          :footer="`工序 ${stepStore.items.filter((s) => s.clockId === item.id && s.state === 'done').length}/${
            stepStore.items.filter((s) => s.clockId === item.id).length
          } · 走时测试 ${stepStore.tests.filter((t) => t.clockId === item.id).length} 次`"
          @open="(id) => router.push(`/clocks/${id}`)"
        />
        <el-empty v-if="col.rows.length === 0" description="暂无" :image-size="60" />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" title="钟表建档" width="620px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="form" label-width="110px">
        <el-form-item label="藏品号" required>
          <el-input v-model="form.clockNo" />
        </el-form-item>
        <el-form-item label="种类">
          <el-select v-model="form.kind">
            <el-option v-for="k in CLOCK_KINDS" :key="k" :label="k" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="机芯型号">
          <el-input v-model="form.caliber" />
        </el-form-item>
        <el-form-item label="国别 / 制作者">
          <el-input v-model="form.origin" style="width: 45%" />
          <el-input v-model="form.maker" style="width: 45%; margin-left: 5%" />
        </el-form-item>
        <el-form-item label="年代">
          <el-input v-model="form.yearMade" placeholder="如 1890" />
        </el-form-item>
        <el-form-item label="钟壳材质">
          <el-input v-model="form.caseMaterial" />
        </el-form-item>
        <el-form-item label="尺寸 mm">
          <el-input v-model="form.size" />
        </el-form-item>
        <el-form-item label="盘面标识">
          <el-input v-model="form.dialMark" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.acquireFrom" />
        </el-form-item>
        <el-form-item label="品相等级">
          <el-select v-model="form.conditionGrade">
            <el-option v-for="g in CONDITION_GRADES" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="存放位置">
          <el-input v-model="form.storagePos" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存建档</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.column {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
</style>
