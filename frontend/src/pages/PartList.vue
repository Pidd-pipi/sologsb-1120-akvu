<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore, PartConflictError } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useLotStore, LotConflictError } from '../stores/lotStore';
import { useLedger } from '../hooks/useLedger';
import StateBadge from '../components/common/StateBadge.vue';
import { InventoryError } from '../utils/inventory';
import {
  PART_DECISIONS,
  PART_NAMES,
  WEAR_STATES,
  type MovementPartDraft,
  type PartDecision,
  type PartName,
  type WearState,
} from '../types/part';
import { LOT_STATUS_LABEL, type PartLot, type PartLotDraft } from '../types/lot';

const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const lotStore = useLotStore();
const { rows: ledgerRows, issues } = useLedger();

const wearFilter = ref<WearState | 'all'>('all');
const clockFilter = ref('all');
const onlyPending = ref(false);
const dialogVisible = ref(false);
const lotDialogVisible = ref(false);
const error = ref('');
const lotError = ref('');

const form = reactive<MovementPartDraft>({
  clockId: '',
  name: '发条',
  qtyNeeded: 1,
  position: '',
  wearState: '磨损',
  decision: '修配',
  sourceLot: '',
  dimension: 1,
});

const lotForm = reactive<PartLotDraft>({
  lotNo: '',
  partName: '发条',
  capacity: 1,
  status: 'verified',
  note: '',
});

const rows = computed(() =>
  partStore.items.filter((p) => {
    if (wearFilter.value !== 'all' && p.wearState !== wearFilter.value) return false;
    if (clockFilter.value !== 'all' && p.clockId !== clockFilter.value) return false;
    if (onlyPending.value && !(p.decision !== '保留' && p.wearState !== '完好')) return false;
    return true;
  }),
);

const groups = computed(() =>
  WEAR_STATES.map((state) => ({ state, rows: rows.value.filter((p) => p.wearState === state) })),
);

const pendingCount = computed(
  () => partStore.items.filter((p) => p.decision !== '保留' && p.wearState !== '完好').length,
);
const pendingLotCount = computed(() => lotStore.items.filter((l) => l.status === 'pending').length);

function clockNo(clockId: string): string {
  return clockStore.byId(clockId)?.clockNo ?? '未知钟表';
}

function lotOf(lotNo: string): PartLot | undefined {
  return lotStore.byNo(lotNo);
}

function ledgerOf(lotNo: string) {
  return ledgerRows.value.find((r) => r.lot.lotNo === lotNo);
}

function openDialog() {
  dialogVisible.value = true;
  error.value = '';
  form.clockId = clockFilter.value !== 'all' ? clockFilter.value : clockStore.items[0]?.id ?? '';
}

function openLotDialog() {
  lotDialogVisible.value = true;
  lotError.value = '';
  lotForm.lotNo = '';
  lotForm.partName = '发条';
  lotForm.capacity = 1;
  lotForm.status = 'verified';
  lotForm.note = '';
}

async function submit() {
  if (!form.clockId) {
    error.value = '请选择所属钟表';
    return;
  }
  if (!form.position.trim()) {
    error.value = '装配位置必填';
    return;
  }
  if (form.qtyNeeded <= 0) {
    error.value = '数量必须大于 0';
    return;
  }
  await partStore.add({
    ...form,
    position: form.position.trim(),
    sourceLot: form.sourceLot.trim(),
  });
  dialogVisible.value = false;
  ElMessage.success('已登记零件');
  form.position = '';
  form.sourceLot = '';
}

async function submitLot() {
  lotError.value = '';
  if (!lotForm.lotNo.trim()) {
    lotError.value = '批号必填';
    return;
  }
  if (lotForm.capacity < 0) {
    lotError.value = '容量不能为负数';
    return;
  }
  try {
    await lotStore.add({ ...lotForm, lotNo: lotForm.lotNo.trim() });
    lotDialogVisible.value = false;
    ElMessage.success(`批号 ${lotForm.lotNo.trim()} 已登记入库`);
  } catch (err) {
    if (err instanceof LotConflictError) lotError.value = err.message;
    else lotError.value = '批号登记失败，请重试';
  }
}

/** 统一处理领用账类错误：容量不足时提示还差多少 */
function handleMutationError(err: unknown): boolean {
  if (err instanceof InventoryError || err instanceof PartConflictError) {
    ElMessage.error(err.message);
    return true;
  }
  if (err instanceof LotConflictError) {
    ElMessage.error(err.message);
    return true;
  }
  return false;
}

async function setDecision(id: string, decision: PartDecision) {
  try {
    await partStore.update(id, { decision });
    ElMessage.success(`处理决定已改为「${decision}」`);
  } catch (err) {
    if (!handleMutationError(err)) ElMessage.error('修改失败，请重试');
  }
}

async function changeQty(id: string, value: number | undefined) {
  if (value === undefined || value <= 0) {
    ElMessage.warning('数量必须大于 0');
    return;
  }
  try {
    await partStore.update(id, { qtyNeeded: value });
    ElMessage.success('用量已修改，批号占用与钟表进度已重算');
  } catch (err) {
    if (!handleMutationError(err)) ElMessage.error('修改失败，请重试');
  }
}

async function changeLot(id: string, value: string) {
  try {
    await partStore.update(id, { sourceLot: (value ?? '').trim() });
    ElMessage.success('来源批号已修改，领用账已重算');
  } catch (err) {
    if (!handleMutationError(err)) ElMessage.error('修改失败，请重试');
  }
}

async function removePart(id: string) {
  try {
    await partStore.remove(id);
    ElMessage.success('零件已删除');
  } catch (err) {
    if (!handleMutationError(err)) ElMessage.error('删除失败，请重试');
  }
}

async function verifyLot(lot: PartLot) {
  try {
    const { value } = await ElMessageBox.prompt(
      `批号 ${lot.lotNo} 当前按已用量回填容量 ${lot.capacity} 件（余量 0）。请输入核账后的实际容量：`,
      '核账入库',
      { inputValue: String(lot.capacity), inputPattern: /^\d+$/, inputErrorMessage: '请输入非负整数' },
    );
    await lotStore.verify(lot.id, Number(value));
    ElMessage.success(`批号 ${lot.lotNo} 已核账入库`);
  } catch (err) {
    if (err !== 'cancel' && err?.constructor?.name !== 'cancel') {
      ElMessage.error('核账失败，请重试');
    }
  }
}

async function changeCapacity(lot: PartLot) {
  try {
    const { value } = await ElMessageBox.prompt(`修改批号 ${lot.lotNo} 的容量：`, '调整容量', {
      inputValue: String(lot.capacity),
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入非负整数',
    });
    const cap = Number(value);
    const ledger = ledgerOf(lot.lotNo);
    if (ledger && cap < ledger.occupied) {
      ElMessage.error(
        `容量不能低于当前已领用 ${ledger.occupied} 件，至少还差 ${ledger.occupied - cap} 件的缺口`,
      );
      return;
    }
    await lotStore.update(lot.id, { capacity: cap });
    ElMessage.success('批号容量已更新');
  } catch (err) {
    if (err !== 'cancel' && err?.constructor?.name !== 'cancel') {
      ElMessage.error('调整失败，请重试');
    }
  }
}

async function removeLot(lot: PartLot) {
  const ledger = ledgerOf(lot.lotNo);
  if (ledger && ledger.occupied > 0) {
    ElMessage.error(`批号 ${lot.lotNo} 已被装配领用 ${ledger.occupied} 件，不能删除；请先回退相关装配工序`);
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除批号 ${lot.lotNo} 的库存记录？`, '删除批号', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await lotStore.remove(lot.id);
  ElMessage.success('批号库存已删除');
}

/** el-autocomplete 建议项：已有批号 */
function lotSuggestions(query: string, cb: (items: { value: string }[]) => void) {
  const q = query.trim();
  cb(lotStore.items.filter((l) => !q || l.lotNo.includes(q)).map((l) => ({ value: l.lotNo })));
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await lotStore.load();
  await stepStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>零件与配换清单</h2>
      <el-tag>共 {{ partStore.items.length }} 项</el-tag>
      <el-tag type="warning">待修配 {{ pendingCount }} 项</el-tag>
      <el-tag :type="pendingLotCount ? 'danger' : 'success'">批号库存 {{ lotStore.items.length }} 条 · 待核 {{ pendingLotCount }}</el-tag>
      <div class="spacer" />
      <el-button @click="openLotDialog">登记批号库存</el-button>
      <el-button type="primary" @click="openDialog">登记零件</el-button>
    </div>

    <!-- 领用账告警：无批号、无库存记录、待核批号、容量不足 -->
    <el-card v-if="issues.length" shadow="never" class="issue-card">
      <el-alert
        v-for="(issue, i) in issues"
        :key="`${issue.code}-${issue.lotNo}-${i}`"
        :title="issue.message"
        :type="issue.code === 'shortage' || issue.code === 'no-lot' || issue.code === 'lot-missing' ? 'error' : 'warning'"
        :closable="false"
        show-icon
        style="margin-bottom: 6px"
      />
    </el-card>

    <!-- 批号库存与占用 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <strong>批号库存（领用账）</strong>
          <span class="muted">完成「装配」工序时按实际用量占用，回退自动释放，多台钟表共用批号实时汇总</span>
        </div>
      </template>
      <el-table :data="lotStore.items" size="small" border>
        <el-table-column prop="lotNo" label="来源批号" width="150" />
        <el-table-column prop="partName" label="零件" width="110" />
        <el-table-column label="容量" width="90">
          <template #default="{ row }">{{ row.capacity }}</template>
        </el-table-column>
        <el-table-column label="已占用" width="90">
          <template #default="{ row }">
            <span :class="{ danger: (ledgerOf(row.lotNo)?.occupied ?? 0) > row.capacity }">
              {{ ledgerOf(row.lotNo)?.occupied ?? 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="余量" width="90">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="
                (ledgerOf(row.lotNo)?.remaining ?? row.capacity) <= 0
                  ? 'danger'
                  : row.status === 'pending'
                    ? 'warning'
                    : 'success'
              "
            >
              {{ ledgerOf(row.lotNo)?.remaining ?? row.capacity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'pending' ? 'warning' : 'success'">
              {{ LOT_STATUS_LABEL[row.status as PartLot['status']] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="250">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="warning" @click="verifyLot(row)">
              核账
            </el-button>
            <el-button size="small" @click="changeCapacity(row)">调容量</el-button>
            <el-button size="small" type="danger" plain @click="removeLot(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="lotStore.items.length === 0" description="暂无批号库存记录" :image-size="60" />

      <!-- 每个批号的逐笔领用 -->
      <template v-for="row in ledgerRows" :key="row.lot.lotNo">
        <div v-if="row.entries.length" class="ledger-detail">
          <div class="ledger-title">
            {{ row.lot.lotNo }}（{{ row.lot.partName }}）领用明细 · 共 {{ row.occupied }} 件
          </div>
          <el-table :data="row.entries" size="small" border>
            <el-table-column label="钟表" width="170">
              <template #default="{ row: e }">{{ e.clock?.clockNo ?? clockNo(e.part.clockId) }}</template>
            </el-table-column>
            <el-table-column label="零件 / 位置" min-width="180">
              <template #default="{ row: e }">{{ e.part.name }} · {{ e.part.position }}</template>
            </el-table-column>
            <el-table-column label="用量" width="80">
              <template #default="{ row: e }">{{ e.qty }}</template>
            </el-table-column>
            <el-table-column label="占用工序" width="140">
              <template #default="{ row: e }">#{{ e.step.seq }} {{ e.step.stepType }}（已完成）</template>
            </el-table-column>
          </el-table>
        </div>
      </template>
    </el-card>

    <el-card shadow="never">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="钟表">
          <el-select v-model="clockFilter" style="width: 220px">
            <el-option label="全部" value="all" />
            <el-option v-for="c in clockStore.items" :key="c.id" :label="c.clockNo" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="磨损状态">
          <el-select v-model="wearFilter" style="width: 140px">
            <el-option label="全部" value="all" />
            <el-option v-for="w in WEAR_STATES" :key="w" :label="w" :value="w" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="onlyPending">只看待修配</el-checkbox>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-for="group in groups" :key="group.state" shadow="never">
      <template #header>
        <div class="card-head">
          <strong>{{ group.state }}</strong>
          <el-tag size="small" type="info">{{ group.rows.length }} 项</el-tag>
        </div>
      </template>
      <el-table :data="group.rows" size="small" border>
        <el-table-column label="钟表" width="150">
          <template #default="{ row }">{{ clockNo(row.clockId) }}</template>
        </el-table-column>
        <el-table-column prop="name" label="零件" width="100" />
        <el-table-column label="用量" width="110">
          <template #default="{ row }">
            <el-input-number
              :model-value="row.qtyNeeded"
              :min="1"
              :max="999"
              size="small"
              controls-position="right"
              @change="(v: number | undefined) => changeQty(row.id, v)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="position" label="装配位置" min-width="140" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <StateBadge :label="row.wearState" :tone="row.wearState === '完好' ? 'success' : 'danger'" />
          </template>
        </el-table-column>
        <el-table-column label="处理决定" width="200">
          <template #default="{ row }">
            <el-radio-group :model-value="row.decision" size="small" @change="(v: unknown) => setDecision(row.id, String(v) as PartDecision)">
              <el-radio-button v-for="d in PART_DECISIONS" :key="d" :value="d">{{ d }}</el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column label="来源批号（可改）" min-width="180">
          <template #default="{ row }">
            <el-autocomplete
              :model-value="row.sourceLot"
              size="small"
              placeholder="如 MS-2024-07"
              :fetch-suggestions="lotSuggestions"
              @change="(v: string) => changeLot(row.id, v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="批号余量" width="90">
          <template #default="{ row }">
            <el-tag v-if="!row.sourceLot && row.decision !== '保留'" size="small" type="danger">无来源</el-tag>
            <el-tag v-else-if="row.sourceLot && !lotOf(row.sourceLot)" size="small" type="danger">无库存</el-tag>
            <el-tag
              v-else-if="row.sourceLot"
              size="small"
              :type="(ledgerOf(row.sourceLot)?.remaining ?? lotOf(row.sourceLot)?.capacity ?? 0) <= 0 ? 'danger' : 'info'"
            >
              余 {{ ledgerOf(row.sourceLot)?.remaining ?? lotOf(row.sourceLot)?.capacity }}
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="dimension" label="尺寸 mm" width="90" />
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click="removePart(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="group.rows.length === 0" description="该状态暂无零件" :image-size="60" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="登记零件" width="560px">
      <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="form" label-width="110px">
        <el-form-item label="所属钟表">
          <el-select v-model="form.clockId" style="width: 100%">
            <el-option v-for="c in clockStore.items" :key="c.id" :label="c.clockNo" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="零件名称">
          <el-select v-model="form.name" style="width: 100%">
            <el-option v-for="n in PART_NAMES" :key="n" :label="n" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="form.qtyNeeded" :min="1" :max="999" />
        </el-form-item>
        <el-form-item label="装配位置" required>
          <el-input v-model="form.position" placeholder="如 二轮上下轴孔" />
        </el-form-item>
        <el-form-item label="磨损状态">
          <el-select v-model="form.wearState" style="width: 100%">
            <el-option v-for="w in WEAR_STATES" :key="w" :label="w" :value="w" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理决定">
          <el-select v-model="form.decision" style="width: 100%">
            <el-option v-for="d in PART_DECISIONS" :key="d" :label="d" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源批号">
          <el-autocomplete
            v-model="form.sourceLot"
            placeholder="如 MS-2024-07，保留件可留空"
            style="width: 100%"
            :fetch-suggestions="lotSuggestions"
          />
        </el-form-item>
        <el-form-item label="关键尺寸 mm">
          <el-input-number v-model="form.dimension" :min="0" :max="200" :step="0.1" :precision="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="lotDialogVisible" title="登记批号库存" width="520px">
      <el-alert v-if="lotError" :title="lotError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="lotForm" label-width="110px">
        <el-form-item label="来源批号" required>
          <el-input v-model="lotForm.lotNo" placeholder="如 MS-2024-07" />
        </el-form-item>
        <el-form-item label="零件名称" required>
          <el-select v-model="lotForm.partName" style="width: 100%">
            <el-option v-for="n in PART_NAMES" :key="n" :label="n" :value="n" />
          </el-select>
        </el-form-item>
        <el-form-item label="容量（件）" required>
          <el-input-number v-model="lotForm.capacity" :min="0" :max="99999" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="lotForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="lotDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitLot">保存入库</el-button>
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
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.issue-card {
  border-left: 3px solid #d93025;
}
.ledger-detail {
  margin: 12px 0 4px;
}
.ledger-title {
  font-size: 13px;
  color: #2f3a46;
  margin-bottom: 6px;
}
:deep(.danger) {
  color: #d93025;
  font-weight: 700;
}
</style>
