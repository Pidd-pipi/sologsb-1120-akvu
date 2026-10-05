<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import { STEP_FIELD_MAP, STEP_TYPES, type RepairStepDraft, type StepType } from '../types/step';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();

const clockId = ref(String(route.query.clockId ?? ''));
const { steps, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const nextSeq = computed(() => (steps.value.length === 0 ? 1 : Math.max(...steps.value.map((s) => s.seq)) + 1));

const form = reactive<RepairStepDraft>({
  clockId: '',
  stepType: '拆解',
  seq: 1,
  partIds: [],
  cleanSolvent: '',
  cleanMethod: '超声',
  oilType: '',
  oilPoints: '',
  torque: 0.5,
  troubleNote: '',
  operator: '',
  startedAt: Date.now(),
  state: 'pending',
});

const error = ref('');
const fields = computed(() => STEP_FIELD_MAP[form.stepType as StepType]);

watch(
  clockId,
  (id) => {
    form.clockId = id;
    form.partIds = [];
  },
  { immediate: true },
);

watch(
  nextSeq,
  (value) => {
    form.seq = value;
  },
  { immediate: true },
);

async function submit() {
  error.value = '';
  if (!clockId.value) {
    error.value = '请先选择钟表';
    return;
  }
  if (!form.operator.trim()) {
    error.value = '责任人必填';
    return;
  }
  const used = steps.value.map((s) => s.seq);
  if (used.includes(form.seq)) {
    error.value = `顺序号 ${form.seq} 已被占用，请改用 ${nextSeq.value}`;
    return;
  }
  if (form.seq > nextSeq.value) {
    error.value = `顺序号跳号：当前最大顺序号为 ${Math.max(0, nextSeq.value - 1)}，新步骤必须用 ${nextSeq.value}`;
    return;
  }
  const created = await stepStore.add({ ...form, clockId: clockId.value, startedAt: Date.now() });
  ElMessage.success(`已追加步骤 #${created.seq} ${created.stepType}`);
  form.operator = '';
  form.troubleNote = '';
  form.partIds = [];
}

async function finish(id: string) {
  await stepStore.finish(id);
  ElMessage.success('步骤已完成');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退');
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  if (!clockId.value && clockStore.items.length > 0) {
    clockId.value = clockStore.items[0].id;
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>新建维修工序</h2>
      <el-tag type="info" effect="plain">建议顺序号 {{ nextSeq }}</el-tag>
      <el-tag type="info" effect="plain">现有步骤 {{ total }} 个</el-tag>
      <el-tag v-if="gaps.length" type="danger">跳号 {{ gaps.join('、') }}</el-tag>
      <div class="spacer" />
      <el-button v-if="clockId" @click="router.push(`/clocks/${clockId}`)">查看钟表详情</el-button>
    </div>

    <div class="grid">
      <el-card shadow="never">
        <template #header><strong>工序信息</strong></template>
        <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 12px" />
        <el-form :model="form" label-width="120px">
          <el-form-item label="钟表">
            <el-select v-model="clockId" style="width: 100%">
              <el-option
                v-for="c in clockStore.items"
                :key="c.id"
                :label="`${c.clockNo} · ${c.caliber}`"
                :value="c.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="步骤类型">
            <el-select v-model="form.stepType" style="width: 100%">
              <el-option v-for="t in STEP_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="顺序号" required>
            <el-input-number v-model="form.seq" :min="1" :max="999" />
            <span class="hint">顺序号不得跳号，必须为 {{ nextSeq }}</span>
          </el-form-item>
          <el-form-item v-if="fields.needSolvent" label="清洗液">
            <el-input v-model="form.cleanSolvent" placeholder="如 石油醚 + 无水乙醇" />
          </el-form-item>
          <el-form-item v-if="fields.needSolvent" label="清洗方式">
            <el-radio-group v-model="form.cleanMethod">
              <el-radio-button value="超声">超声</el-radio-button>
              <el-radio-button value="手工">手工</el-radio-button>
              <el-radio-button value="汽油刷洗">汽油刷洗</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="fields.needOil" label="润滑油脂">
            <el-input v-model="form.oilType" placeholder="如 Moebius 9010" />
          </el-form-item>
          <el-form-item v-if="fields.needOil" label="润滑点位">
            <el-input v-model="form.oilPoints" placeholder="如 二轮上下轴孔、擒纵叉瓦" />
          </el-form-item>
          <el-form-item v-if="fields.needTorque" label="拧紧力矩">
            <el-input-number v-model="form.torque" :min="0" :max="50" :step="0.1" :precision="2" />
            <span class="hint">N·m</span>
          </el-form-item>
          <el-form-item label="关联零件">
            <el-select v-model="form.partIds" multiple style="width: 100%" placeholder="可多选">
              <el-option
                v-for="p in parts"
                :key="p.id"
                :label="`${p.name} · ${p.position}`"
                :value="p.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="异常说明">
            <el-input v-model="form.troubleNote" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="责任人" required>
            <el-input v-model="form.operator" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="submit">保存步骤</el-button>
            <el-button @click="router.push('/clocks')">返回台账</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>该钟表现有工序</strong>
            <el-tag size="small">{{ percent }}%</el-tag>
            <span v-if="current" class="muted">当前卡点 #{{ current.seq }} {{ current.stepType }}</span>
            <span v-else class="muted">全部完成</span>
          </div>
        </template>
        <StepSequence :items="steps" @finish="finish" @rollback="rollback" />
      </el-card>
    </div>
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
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: 14px;
  align-items: start;
}
.hint {
  margin-left: 10px;
  color: #7b8592;
  font-size: 13px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
</style>
