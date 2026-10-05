<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useStockStore } from '../stores/stockStore';
import { usePartStore } from '../stores/partStore';
import { useClockStore } from '../stores/clockStore';
import { useStepStore } from '../stores/stepStore';

const stockStore = useStockStore();
const partStore = usePartStore();
const clockStore = useClockStore();
const stepStore = useStepStore();

const dialogVisible = ref(false);
const form = reactive({ lot: '', qty: 1 });

const rows = computed(() =>
  stockStore.stocks
    .map((s) => {
      const occupied = stockStore.occupiedByLot[s.lot] ?? 0;
      return {
        id: s.id,
        lot: s.lot,
        qtyTotal: s.qtyTotal,
        occupied,
        available: s.qtyTotal - occupied,
        status: s.status,
        note: s.note,
      };
    })
    .sort((a, b) => a.lot.localeCompare(b.lot)),
);

const ledgerRows = computed(() =>
  [...stockStore.claims]
    .sort((a, b) => b.claimedAt - a.claimedAt)
    .map((c) => {
      const part = partStore.items.find((p) => p.id === c.partId);
      const clock = clockStore.byId(c.clockId);
      const step = stepStore.items.find((s) => s.id === c.stepId);
      return {
        id: c.id,
        lot: c.lot,
        partName: part?.name ?? '（已删零件）',
        partPosition: part?.position ?? '',
        clockNo: clock?.clockNo ?? '（已删钟表）',
        stepLabel: step ? `#${step.seq} ${step.stepType}` : '（已删工序）',
        qty: c.qty,
        claimedAt: c.claimedAt,
      };
    }),
);

const pendingCount = computed(() => stockStore.stocks.filter((s) => s.status === 'pending').length);

function openDialog(lot = '') {
  form.lot = lot;
  form.qty = 1;
  dialogVisible.value = true;
}

async function submit() {
  const lot = form.lot.trim();
  if (!lot) {
    ElMessage.error('批号必填');
    return;
  }
  try {
    await stockStore.addStock(lot, form.qty);
    ElMessage.success(`批号「${lot}」已入库 ${form.qty}`);
    dialogVisible.value = false;
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '入库失败');
  }
}

async function verify(lot: string) {
  await stockStore.verifyStock(lot);
  ElMessage.success(`批号「${lot}」已核销为正常`);
}

onMounted(async () => {
  await Promise.all([stockStore.load(), partStore.load(), clockStore.load(), stepStore.load()]);
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>批号库存与领用账</h2>
      <el-tag>批号 {{ stockStore.stocks.length }} 个</el-tag>
      <el-tag type="warning">待核 {{ pendingCount }} 个</el-tag>
      <el-tag type="info" effect="plain">领用记录 {{ ledgerRows.length }} 条</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openDialog()">批号入库</el-button>
    </div>

    <el-card shadow="never">
      <template #header><strong>批号库存</strong></template>
      <el-table :data="rows" size="small" border>
        <el-table-column prop="lot" label="来源批号" min-width="140" />
        <el-table-column prop="qtyTotal" label="入库总数" width="100" />
        <el-table-column prop="occupied" label="已占用" width="100" />
        <el-table-column label="可用" width="100">
          <template #default="{ row }">
            <strong :class="{ 'low': row.available <= 0 }">{{ row.available }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="warning" size="small">待核</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row.lot)">入库</el-button>
            <el-button v-if="row.status === 'pending'" size="small" type="success" @click="verify(row.lot)">
              核销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="rows.length === 0" description="暂无批号库存，请先入库" :image-size="60" />
    </el-card>

    <el-card shadow="never">
      <template #header><strong>领用账（零件 · 工序 · 钟表）</strong></template>
      <el-table :data="ledgerRows" size="small" border>
        <el-table-column prop="lot" label="来源批号" min-width="130" />
        <el-table-column label="零件" min-width="160">
          <template #default="{ row }">
            {{ row.partName }}
            <span class="muted">（{{ row.partPosition }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="clockNo" label="钟表" min-width="150" />
        <el-table-column prop="stepLabel" label="工序" width="120" />
        <el-table-column prop="qty" label="占用数量" width="90" />
        <el-table-column label="领用时间" width="180">
          <template #default="{ row }">{{ new Date(row.claimedAt).toLocaleString('zh-CN') }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="ledgerRows.length === 0" description="暂无领用记录" :image-size="60" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="批号入库" width="460px">
      <el-form label-width="100px">
        <el-form-item label="来源批号" required>
          <el-input v-model="form.lot" placeholder="如 MS-2024-07" />
        </el-form-item>
        <el-form-item label="入库数量" required>
          <el-input-number v-model="form.qty" :min="1" :max="9999" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存入库</el-button>
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
.muted {
  color: #7b8592;
  font-size: 13px;
}
.low {
  color: #d93025;
}
</style>
