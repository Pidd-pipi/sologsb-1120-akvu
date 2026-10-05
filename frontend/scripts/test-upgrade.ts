import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { newId } from '../src/utils/id';

process.on('unhandledRejection', (e) => {
  console.log('UNHANDLED REJECTION:', e);
});

async function main() {
  let pass = 0;
  let fail = 0;
  function check(name: string, cond: boolean, extra = '') {
    if (cond) {
      pass++;
      console.log(`  PASS: ${name}`);
    } else {
      fail++;
      console.log(`  FAIL: ${name} ${extra}`);
    }
  }

  // 1. Build a v2 database with parts/steps but NO stocks/claims (legacy data)
  const legacy = new Dexie('gbclockrepair');
  legacy.version(2).stores({
    clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
    parts: 'id, clockId, name, wearState, decision, sourceLot',
    steps: 'id, clockId, seq, stepType, state, startedAt',
    tests: 'id, clockId, testedAt, conclusion',
  });
  await legacy.open();

  const clockId = newId('clk');
  const partA = newId('prt');
  const partB = newId('prt');
  const partC = newId('prt'); // no source lot
  const stepDone = newId('stp');
  const stepPending = newId('stp');

  await legacy.table('clocks').put({
    id: clockId,
    clockNo: 'CLK-LEGACY-001',
    kind: '座钟',
    caliber: 'Test',
    origin: '',
    maker: '',
    yearMade: '',
    caseMaterial: '',
    size: '',
    dialMark: '',
    acquireFrom: '',
    conditionGrade: '待修',
    storagePos: '',
    createdAt: Date.now(),
  });
  await legacy.table('parts').bulkPut([
    { id: partA, clockId, name: '发条', qtyNeeded: 2, position: '条盒', wearState: '断裂', decision: '换新', sourceLot: 'LOT-A', dimension: 1 },
    { id: partB, clockId, name: '宝石轴承', qtyNeeded: 4, position: '轴孔', wearState: '磨损', decision: '修配', sourceLot: 'LOT-B', dimension: 1 },
    { id: partC, clockId, name: '摆轮', qtyNeeded: 1, position: '摆夹板', wearState: '完好', decision: '保留', sourceLot: '', dimension: 1 },
  ]);
  await legacy.table('steps').bulkPut([
    {
      id: stepDone,
      clockId,
      stepType: '拆解',
      seq: 1,
      partIds: [partA, partB],
      cleanSolvent: '',
      cleanMethod: '超声',
      oilType: '',
      oilPoints: '',
      torque: 0.5,
      troubleNote: '',
      operator: 'x',
      startedAt: Date.now() - 100000,
      finishedAt: Date.now() - 50000,
      state: 'done',
    },
    {
      id: stepPending,
      clockId,
      stepType: '装配',
      seq: 2,
      partIds: [partB],
      cleanSolvent: '',
      cleanMethod: '超声',
      oilType: '',
      oilPoints: '',
      torque: 0.5,
      troubleNote: '',
      operator: 'x',
      startedAt: Date.now(),
      state: 'pending',
    },
  ]);
  await legacy.close();

  // 2. Open with the v3 singleton → triggers v3 upgrade
  const { db } = await import('../src/utils/db');
  await db.open();

  // 3. Verify backfill
  const stocks = await db.stocks.toArray();
  const claims = await db.claims.toArray();
  check('stocks backfilled for LOT-A and LOT-B', stocks.length === 2, `got ${stocks.length}`);
  const stockA = stocks.find((s) => s.lot === 'LOT-A');
  const stockB = stocks.find((s) => s.lot === 'LOT-B');
  check('LOT-A pending, qtyTotal 2 (used)', stockA?.status === 'pending' && stockA?.qtyTotal === 2);
  check('LOT-B pending, qtyTotal 4 (used)', stockB?.status === 'pending' && stockB?.qtyTotal === 4);
  check('claims backfilled: 2 (one per part in done step)', claims.length === 2, `got ${claims.length}`);
  check('claim for LOT-A qty 2', claims.some((c) => c.lot === 'LOT-A' && c.qty === 2));
  check('claim for LOT-B qty 4', claims.some((c) => c.lot === 'LOT-B' && c.qty === 4));
  check('no claim for sourceless partC', !claims.some((c) => c.partId === partC));

  // 4. Pending step referencing LOT-B → rejected (待核)
  const { useStockStore } = await import('../src/stores/stockStore');
  const { useStepStore } = await import('../src/stores/stepStore');
  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  const stockStore = useStockStore();
  const stepStore = useStepStore();
  await Promise.all([stockStore.load(), stepStore.load()]);
  let msg = '';
  try {
    await stepStore.finish(stepPending);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check('pending step rejected (待核)', msg.includes('待核'), msg);
  check('pending step still pending', (await db.steps.get(stepPending))?.state === 'pending');

  // 5. 入库 LOT-B 10 → now normal, available = 10 - 4 = 6 >= 4 → success
  console.log('  >> before addStock');
  await stockStore.addStock('LOT-B', 10);
  console.log('  >> after addStock, before finish');
  const ok = await stepStore.finish(stepPending);
  console.log('  >> after finish');
  check('finish succeeds after 入库', ok === true);
  check('LOT-B available = 6', (stockStore.availableByLot['LOT-B'] ?? 0) === 6);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
