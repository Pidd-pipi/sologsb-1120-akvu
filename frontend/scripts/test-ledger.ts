import 'fake-indexeddb/auto';
import { db, ensureSeedData, DB_VERSION } from '../src/utils/db';
import { useStockStore } from '../src/stores/stockStore';
import { useStepStore } from '../src/stores/stepStore';
import { usePartStore } from '../src/stores/partStore';
import { useClockStore } from '../src/stores/clockStore';
import { setActivePinia, createPinia } from 'pinia';

async function main() {
  setActivePinia(createPinia());
  await ensureSeedData();

  const stockStore = useStockStore();
  const stepStore = useStepStore();
  const partStore = usePartStore();
  const clockStore = useClockStore();
  await Promise.all([stockStore.load(), stepStore.load(), partStore.load(), clockStore.load()]);

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

  // 1. Seed has stocks + claims
  check('seed stocks present', stockStore.stocks.length === 2, `got ${stockStore.stocks.length}`);
  check('seed claims present', stockStore.claims.length === 2, `got ${stockStore.claims.length}`);
  const jwl = stockStore.stocks.find((s) => s.lot === 'JWL-18');
  check('JWL-18 normal, qtyTotal 20', jwl?.status === 'normal' && jwl?.qtyTotal === 20);
  check('JWL-18 available 16', (stockStore.availableByLot['JWL-18'] ?? 0) === 16);

  // 2. Finish pending 润滑 step (references 宝石轴承 qty 4, JWL-18)
  const runhua = stepStore.items.find((s) => s.stepType === '润滑');
  check('润滑 step pending', runhua?.state === 'pending');
  const beforeAvail = stockStore.availableByLot['JWL-18'];
  const occupied = await stepStore.finish(runhua!.id);
  check('finish returns true', occupied === true);
  check('润滑 step done', stepStore.items.find((s) => s.id === runhua!.id)?.state === 'done');
  check('JWL-18 available reduced by 4', stockStore.availableByLot['JWL-18'] === beforeAvail - 4);
  check('claims now 3', stockStore.claims.length === 3);

  // 3. Finish same step again → idempotent (false)
  const occupied2 = await stepStore.finish(runhua!.id);
  check('re-finish returns false (idempotent)', occupied2 === false);
  check('claims still 3', stockStore.claims.length === 3);

  // 4. Rollback → release
  await stepStore.rollback(runhua!.id);
  check('润滑 step rolledback', stepStore.items.find((s) => s.id === runhua!.id)?.state === 'rolledback');
  check('JWL-18 available restored', stockStore.availableByLot['JWL-18'] === beforeAvail);
  check('claims back to 2', stockStore.claims.length === 2);

  // 5. Insufficient stock: drain JWL-18 to 0 then try finish
  // 入库 only 4 more (currently 16 avail after rollback → add 0). Let's set up: 16 avail, need 4 → ok.
  // To force shortage, reduce stock. Easiest: create a new part with a lot that has 0 stock.
  const newPart = await partStore.add({
    clockId: runhua!.clockId,
    name: '螺丝',
    qtyNeeded: 5,
    position: '测试位',
    wearState: '磨损',
    decision: '修配',
    sourceLot: 'EMPTY-LOT',
    dimension: 1,
  });
  // add a step referencing this part
  const newStep = await stepStore.add({
    clockId: runhua!.clockId,
    stepType: '装配',
    seq: 99,
    partIds: [newPart.id],
    cleanSolvent: '',
    cleanMethod: '超声',
    oilType: '',
    oilPoints: '',
    torque: 0.5,
    troubleNote: '',
    operator: 'test',
    startedAt: Date.now(),
    state: 'pending',
  });
  let shortageMsg = '';
  try {
    await stepStore.finish(newStep.id);
  } catch (e) {
    shortageMsg = e instanceof Error ? e.message : String(e);
  }
  check('new lot treated as 待核 (legacy rule)', shortageMsg.includes('待核'), shortageMsg);
  check('new step still pending', stepStore.items.find((s) => s.id === newStep.id)?.state === 'pending');
  check('no claim for EMPTY-LOT', !stockStore.claims.some((c) => c.lot === 'EMPTY-LOT'));

  // 6. 入库 EMPTY-LOT 3 → still short by 2
  await stockStore.addStock('EMPTY-LOT', 3);
  try {
    await stepStore.finish(newStep.id);
  } catch (e) {
    shortageMsg = e instanceof Error ? e.message : String(e);
  }
  check('still short after partial 入库', shortageMsg.includes('还差 2'), shortageMsg);

  // 7. 入库 2 more → success
  await stockStore.addStock('EMPTY-LOT', 2);
  const ok = await stepStore.finish(newStep.id);
  check('finish succeeds after restock', ok === true);
  check('EMPTY-LOT available 0', (stockStore.availableByLot['EMPTY-Lot'] ?? stockStore.availableByLot['EMPTY-LOT']) === 0);

  // 8. Modify part qty 5 → 8 → rebuild claims, insufficient (avail 0, need 8, 还差 8)
  let modMsg = '';
  try {
    await partStore.update(newPart.id, { qtyNeeded: 8 });
  } catch (e) {
    modMsg = e instanceof Error ? e.message : String(e);
  }
  check('qty increase rejected (insufficient, old claim released first)', modMsg.includes('还差 3'), modMsg);
  // part qty unchanged (transaction rolled back)
  check('part qty unchanged after rollback', partStore.items.find((p) => p.id === newPart.id)?.qtyNeeded === 5);

  // 9. Concurrent finish: two steps both need the last stock.
  // Setup: lot LAST-LOT qtyTotal 5, two parts qty 3 each, two steps.
  await stockStore.addStock('LAST-LOT', 5);
  const pA = await partStore.add({
    clockId: runhua!.clockId,
    name: '螺丝',
    qtyNeeded: 3,
    position: 'A',
    wearState: '磨损',
    decision: '修配',
    sourceLot: 'LAST-LOT',
    dimension: 1,
  });
  const pB = await partStore.add({
    clockId: runhua!.clockId,
    name: '螺丝',
    qtyNeeded: 3,
    position: 'B',
    wearState: '磨损',
    decision: '修配',
    sourceLot: 'LAST-LOT',
    dimension: 1,
  });
  const sA = await stepStore.add({
    clockId: runhua!.clockId,
    stepType: '装配',
    seq: 100,
    partIds: [pA.id],
    cleanSolvent: '',
    cleanMethod: '超声',
    oilType: '',
    oilPoints: '',
    torque: 0.5,
    troubleNote: '',
    operator: 'A',
    startedAt: Date.now(),
    state: 'pending',
  });
  const sB = await stepStore.add({
    clockId: runhua!.clockId,
    stepType: '装配',
    seq: 101,
    partIds: [pB.id],
    cleanSolvent: '',
    cleanMethod: '超声',
    oilType: '',
    oilPoints: '',
    torque: 0.5,
    troubleNote: '',
    operator: 'B',
    startedAt: Date.now(),
    state: 'pending',
  });
  // Fire both concurrently (simulating two tabs). IndexedDB serializes the rw transactions.
  const results = await Promise.allSettled([stepStore.finish(sA.id), stepStore.finish(sB.id)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  check('concurrent: one fulfilled, one rejected', fulfilled === 1 && rejected === 1, `fulfilled=${fulfilled} rejected=${rejected}`);
  check('LAST-LOT available = 2 (5-3)', (stockStore.availableByLot['LAST-LOT'] ?? 0) === 2);
  check('only one claim for LAST-LOT', stockStore.claims.filter((c) => c.lot === 'LAST-LOT').length === 1);

  // 10. Legacy backfill: simulate v2 DB (no stocks/claims) → upgrade to v3
  // We can't easily downgrade, but we can test backfillLot directly.
  // Create a fresh DB at v2 by deleting stocks/claims and setting version back.
  // Instead, test backfillLot on a lot with no stock record.
  const backfillStock = await stockStore.backfillLot('BRAND-NEW-LOT');
  check('backfill creates pending stock', backfillStock.status === 'pending');
  check('backfill qtyTotal 0 (no usage)', backfillStock.qtyTotal === 0);

  // 11. DB_VERSION is 3
  check('DB_VERSION === 3', DB_VERSION === 3, `got ${DB_VERSION}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
