import 'fake-indexeddb/auto';
import { setActivePinia, createPinia } from 'pinia';
import Dexie from 'dexie';
import { ClockRepairDB } from '../src/utils/db';
import { db } from '../src/utils/db';
import { usePartStore } from '../src/stores/partStore';
import { useStepStore } from '../src/stores/stepStore';
import { useLotStore } from '../src/stores/lotStore';
import { InventoryError, checkAssemblyFinish } from '../src/utils/inventory';

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log('  ✓', label);
  } else {
    fail++;
    console.log('  ✗', label);
  }
}

async function wipe() {
  await db.table('clocks').clear();
  await db.table('parts').clear();
  await db.table('lots').clear();
  await db.table('steps').clear();
  await db.table('tests').clear();
}

async function scenarioLedger() {
  console.log('场景 A：容量不足拒绝 + 报缺口 + 回退释放 + 改量重算');
  await wipe();
  const pinia = createPinia();
  setActivePinia(pinia);
  const parts = usePartStore();
  const steps = useStepStore();
  const lots = useLotStore();

  await db.clocks.bulkPut([
    {
      id: 'c1',
      clockNo: 'A钟',
      kind: '座钟',
      caliber: 'X',
      origin: '',
      maker: '',
      yearMade: '',
      caseMaterial: '',
      size: '',
      dialMark: '',
      acquireFrom: '',
      conditionGrade: '三级',
      storagePos: '',
      createdAt: 1,
    },
  ]);
  const p1 = await parts.add({
    clockId: 'c1',
    name: '发条',
    qtyNeeded: 1,
    position: '条盒',
    wearState: '断裂',
    decision: '换新',
    sourceLot: 'L1',
    dimension: 1,
  });
  await lots.add({ lotNo: 'L1', partName: '发条', capacity: 0, status: 'verified', note: '' });
  const s1 = await steps.add({
    clockId: 'c1',
    stepType: '装配',
    seq: 1,
    partIds: [p1.id],
    cleanSolvent: '',
    cleanMethod: '',
    oilType: '',
    oilPoints: '',
    torque: 0,
    troubleNote: '',
    operator: '甲',
    startedAt: 1,
    state: 'pending',
  });

  let blocked: unknown = null;
  try {
    await steps.finish(s1.id);
  } catch (e) {
    blocked = e;
  }
  assert(blocked instanceof InventoryError, '容量 0：完成装配被拒绝');
  assert((blocked as InventoryError).message.includes('还差 1 件'), '提示「还差 1 件」');

  // 事务回滚：步骤仍是 pending
  await steps.load();
  const stillPending = (await db.steps.get(s1.id))?.state === 'pending';
  assert(stillPending, '拒绝后步骤保持 pending（事务整体回滚）');

  // 调到容量 1 后完成成功
  await lots.update(lots.items[0].id, { capacity: 1 });
  await steps.finish(s1.id);
  assert((await db.steps.get(s1.id))?.state === 'done', '容量补足后完成成功');

  // 占用 1
  const view = lots.ledger(steps.items, parts.items, await db.clocks.toArray());
  assert(view[0]?.occupied === 1 && view[0]?.remaining === 0, '批号占用 1、余量 0');

  // 回退释放
  await steps.rollback(s1.id);
  const view2 = lots.ledger(steps.items, parts.items, await db.clocks.toArray());
  assert(view2.length === 0, '回退后占用释放');
  assert(steps.items[0]?.state === 'rolledback', '步骤状态 rolledback，进度重算');

  // 再完成 + 改用量到 2（容量 1）被拒
  await steps.finish(s1.id);
  let qtyErr: unknown = null;
  try {
    await parts.update(p1.id, { qtyNeeded: 2 });
  } catch (e) {
    qtyErr = e;
  }
  assert(qtyErr instanceof InventoryError, '改用量到 2 超过容量被拒');
  await parts.load();
  const p1Now = parts.items.find((p) => p.id === p1.id);
  assert(p1Now?.qtyNeeded === 1, '被拒后用量回滚仍为 1');

  // 容量调到 2，改量成功
  await lots.update(lots.items[0].id, { capacity: 2 });
  await parts.update(p1.id, { qtyNeeded: 2 });
  const view3 = lots.ledger(steps.items, parts.items, await db.clocks.toArray());
  assert(view3[0]?.occupied === 2 && view3[0]?.remaining === 0, '改量后占用重算为 2');
}

async function scenarioTwoClocks() {
  console.log('场景 B：两台钟抢同一批号，先完成一方占用，后完成一方失败');
  await wipe();
  setActivePinia(createPinia());
  const parts = usePartStore();
  const steps = useStepStore();
  const lots = useLotStore();

  await db.clocks.bulkPut([
    {
      id: 'c1',
      clockNo: 'A',
      kind: '座钟',
      caliber: '',
      origin: '',
      maker: '',
      yearMade: '',
      caseMaterial: '',
      size: '',
      dialMark: '',
      acquireFrom: '',
      conditionGrade: '三级',
      storagePos: '',
      createdAt: 1,
    },
    {
      id: 'c2',
      clockNo: 'B',
      kind: '怀表',
      caliber: '',
      origin: '',
      maker: '',
      yearMade: '',
      caseMaterial: '',
      size: '',
      dialMark: '',
      acquireFrom: '',
      conditionGrade: '三级',
      storagePos: '',
      createdAt: 2,
    },
  ]);
  await lots.add({ lotNo: 'L1', partName: '发条', capacity: 1, status: 'verified', note: '' });
  const pa = await parts.add({
    clockId: 'c1',
    name: '发条',
    qtyNeeded: 1,
    position: 'a',
    wearState: '断裂',
    decision: '换新',
    sourceLot: 'L1',
    dimension: 1,
  });
  const pb = await parts.add({
    clockId: 'c2',
    name: '发条',
    qtyNeeded: 1,
    position: 'b',
    wearState: '断裂',
    decision: '换新',
    sourceLot: 'L1',
    dimension: 1,
  });
  const sa = await steps.add({
    clockId: 'c1',
    stepType: '装配',
    seq: 1,
    partIds: [pa.id],
    cleanSolvent: '',
    cleanMethod: '',
    oilType: '',
    oilPoints: '',
    torque: 0,
    troubleNote: '',
    operator: '甲',
    startedAt: 1,
    state: 'pending',
  });
  const sb = await steps.add({
    clockId: 'c2',
    stepType: '装配',
    seq: 1,
    partIds: [pb.id],
    cleanSolvent: '',
    cleanMethod: '',
    oilType: '',
    oilPoints: '',
    torque: 0,
    troubleNote: '',
    operator: '乙',
    startedAt: 2,
    state: 'pending',
  });

  await steps.finish(sa.id);
  let err: unknown = null;
  try {
    await steps.finish(sb.id);
  } catch (e) {
    err = e;
  }
  assert(err instanceof InventoryError, '第二台完成被拒');
  assert((err as InventoryError).message.includes('还差 1 件'), '报「还差 1 件」');
  assert((await db.steps.get(sb.id))?.state === 'pending', '第二台保持 pending');

  // 先领一方回退后，第二台可完成
  await steps.rollback(sa.id);
  await steps.finish(sb.id);
  assert((await db.steps.get(sb.id))?.state === 'done', 'A 回退释放后 B 完成成功');
}

async function scenarioOldData() {
  console.log('场景 C：v2 旧数据迁移，缺库存记录按已用量回填待核，空批号不入库');
  // 用独立库名，避免与单例 db 互相干扰
  const migName = 'gbclockrepair-migtest';
  await new Promise<void>((resolve, reject) => {
    const req = (globalThis as any).indexedDB.deleteDatabase(migName);
    req.onsuccess = () => { resolve(); };
    req.onerror = () => reject(req.error);
  });

  // 先按 v2 结构灌旧数据
  const oldDb = new Dexie(migName);
  oldDb.version(2).stores({
    clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
    parts: 'id, clockId, name, wearState, decision, sourceLot',
    steps: 'id, clockId, seq, stepType, state, startedAt',
    tests: 'id, clockId, testedAt, conclusion',
  });
  await oldDb.open();
  await oldDb.table('clocks').put({ id: 'c1', clockNo: '旧钟', kind: '座钟', createdAt: 1 });
  await oldDb.table('parts').bulkPut([
    {
      id: 'p1',
      clockId: 'c1',
      name: '发条',
      qtyNeeded: 2,
      position: 'x',
      wearState: '断裂',
      decision: '换新',
      sourceLot: 'OLD-1',
      dimension: 1,
    },
    {
      id: 'p2',
      clockId: 'c1',
      name: '宝石轴承',
      qtyNeeded: 3,
      position: 'y',
      wearState: '磨损',
      decision: '修配',
      sourceLot: 'OLD-2',
      dimension: 1,
    },
    // 空批号换新件：不回填
    {
      id: 'p3',
      clockId: 'c1',
      name: '擒纵轮',
      qtyNeeded: 1,
      position: 'z',
      wearState: '断裂',
      decision: '换新',
      sourceLot: '',
      dimension: 1,
    },
    // 保留件即使有批号也不回填
    {
      id: 'p4',
      clockId: 'c1',
      name: '摆轮',
      qtyNeeded: 1,
      position: 'w',
      wearState: '完好',
      decision: '保留',
      sourceLot: 'OLD-3',
      dimension: 1,
    },
  ]);
  await oldDb.close();

  // 用完整 v3 类打开，触发 v2->v3 upgrade
  const migDb = new ClockRepairDB(migName);
  await migDb.open();
  assert(migDb.tables.some((t) => t.name === 'lots'), 'v3 含 lots 表');
  const lots = await migDb.lots.toArray();
  const l1 = lots.find((l) => l.lotNo === 'OLD-1');
  const l2 = lots.find((l) => l.lotNo === 'OLD-2');
  assert(l1?.capacity === 2 && l1.status === 'pending', 'OLD-1 按已用量 2 回填待核');
  assert(l2?.capacity === 3 && l2.status === 'pending', 'OLD-2 按已用量 3 回填待核');
  assert(!lots.some((l) => ['', 'OLD-3'].includes(l.lotNo)), '空批号与保留件批号未回填');

  // 待核批号：再领 1 件完成装配必须被拒（不能把待核旧库存当可用）
  const [parts, clocks] = await Promise.all([migDb.parts.toArray(), migDb.clocks.toArray()]);
  const step = {
    id: 'snew',
    clockId: 'c1',
    stepType: '装配' as const,
    seq: 9,
    partIds: ['p1'],
    cleanSolvent: '',
    cleanMethod: '',
    oilType: '',
    oilPoints: '',
    torque: 0,
    troubleNote: '',
    operator: '甲',
    startedAt: 3,
    state: 'pending' as const,
  };
  const issue = checkAssemblyFinish({ step, steps: [step], parts, lots, clocks });
  assert(issue?.code === 'pending', '待核批号不能继续领用');
  assert(issue?.message.includes('待核') ?? false, '提示为待核库存');

  // 核账（容量提到 5）后可完成
  await migDb.lots.update(l1!.id, { status: 'verified', verifiedAt: 9, note: '已核账', capacity: 5 });
  const lots2 = await migDb.lots.toArray();
  const issue2 = checkAssemblyFinish({ step, steps: [step], parts, lots: lots2, clocks });
  assert(issue2 === null, '核账并补足容量后装配可完成');
  migDb.close();
}

async function main() {
  await scenarioLedger();
  await scenarioTwoClocks();
  await scenarioOldData();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  process.exit(0);
}

void main();
