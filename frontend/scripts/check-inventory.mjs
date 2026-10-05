import { build } from 'esbuild';
const result = await build({
  entryPoints: ['src/utils/inventory.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const { evaluateLedger, shortageOf, checkAssemblyFinish } = mod;


function makePart(over) {
  return {
    id: 'p1',
    clockId: 'c1',
    name: '发条',
    qtyNeeded: 1,
    position: 'x',
    wearState: '断裂',
    decision: '换新',
    sourceLot: 'L1',
    dimension: 1,
    ...over,
  };
}
function makeStep(over) {
  return {
    id: 's1',
    clockId: 'c1',
    stepType: '装配',
    seq: 1,
    partIds: ['p1'],
    cleanSolvent: '',
    cleanMethod: '',
    oilType: '',
    oilPoints: '',
    torque: 0,
    troubleNote: '',
    operator: '甲',
    startedAt: 1,
    state: 'pending',
    ...over,
  };
}
function makeLot(over = {}) {
  return { id: 'lot1', lotNo: 'L1', partName: '发条', capacity: 1, status: 'verified', note: '', createdAt: 1, ...over };
}
function makeClock(id, no) {
  return { id, clockNo: no, kind: '座钟', caliber: '', origin: '', maker: '', yearMade: '', caseMaterial: '', size: '', dialMark: '', acquireFrom: '', conditionGrade: '三级', storagePos: '', createdAt: 1 };
}

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label); }
}

// 场景1：容量不足完成装配 -> 报 shortage 且指出还差多少
{
  const step = makeStep({ state: 'pending' });
  const issue = checkAssemblyFinish({
    step,
    steps: [step],
    parts: [makePart()],
    lots: [makeLot({ capacity: 0 })],
  });
  assert(issue?.code === 'shortage', '容量 0 领 1：拒绝');
  assert(issue?.short === 1, `还差 1 件（实际 ${issue?.short}）`);
  assert(/还差 1 件/.test(issue?.message ?? ''), '消息含「还差 1 件」');
}

// 场景2：两台钟表同批号，各领 1，容量 1
{
  const s1 = makeStep({ id: 's1', clockId: 'c1', state: 'done', partIds: ['p1'] });
  const s2 = makeStep({ id: 's2', clockId: 'c2', state: 'pending', partIds: ['p2'] });
  const parts = [
    makePart({ id: 'p1', clockId: 'c1' }),
    makePart({ id: 'p2', clockId: 'c2' }),
  ];
  const clocks = [makeClock('c1', 'A'), makeClock('c2', 'B')];
  const issue = checkAssemblyFinish({ step: s2, steps: [s1, s2], parts, lots: [makeLot()], clocks });
  assert(issue?.code === 'shortage' && issue.short === 1, '第二台完成时被拒绝，还差 1');
  // 模拟两个页签同时提交：第一台完成后，第二台基于已落库数据再算
  const s2done = { ...s2, state: 'done' };
  const { occupancy } = evaluateLedger({ steps: [s1, s2done], parts, lots: [makeLot()], clocks });
  assert(occupancy.get('L1')?.occupied === 2, '两次占用合计 2');
  assert(shortageOf(occupancy)[0]?.short === 1, '超占 1');
}

// 场景3：同一零件挂多道工序不重复算
{
  const parts = [makePart({ id: 'p1' })];
  const steps = [
    makeStep({ id: 's1', state: 'done', partIds: ['p1'] }),
    makeStep({ id: 's2', state: 'done', seq: 2, partIds: ['p1'] }),
  ];
  const { occupancy } = evaluateLedger({ steps, parts, lots: [makeLot({ capacity: 5 })] });
  assert(occupancy.get('L1')?.occupied === 1, '同零件多道装配只占 1 件');
}

// 场景4：回退装配 -> 占用释放
{
  const parts = [makePart()];
  const rolled = makeStep({ state: 'rolledback' });
  const { occupancy, entries } = evaluateLedger({ steps: [rolled], parts, lots: [makeLot()] });
  assert(entries.length === 0 && occupancy.size === 0, '回退后无占用');
}

// 场景5：无批号换新件 -> no-lot 拒绝；保留件不领用
{
  const step = makeStep({ partIds: ['p1', 'p2'] });
  const parts = [
    makePart({ id: 'p1', sourceLot: '' }),
    makePart({ id: 'p2', decision: '保留', wearState: '完好', sourceLot: '' }),
  ];
  const issue = checkAssemblyFinish({ step, steps: [step], parts, lots: [] });
  assert(issue?.code === 'no-lot', '换新无批号被拒绝');
  const keptStep = makeStep({ partIds: ['p2'] });
  const ok = checkAssemblyFinish({ step: keptStep, steps: [keptStep], parts: [parts[1]], lots: [] });
  assert(ok === null, '保留件无批号可正常完成');
}

// 场景6：批号不存在 / 名称不符 / 待核批号
{
  let step = makeStep();
  assert(checkAssemblyFinish({ step, steps: [step], parts: [makePart()], lots: [] })?.code === 'lot-missing', '无库存记录拒绝');
  assert(
    checkAssemblyFinish({ step, steps: [step], parts: [makePart()], lots: [makeLot({ partName: '摆轮' })] })?.code ===
      'name-mismatch',
    '名称不符拒绝',
  );
  assert(
    checkAssemblyFinish({ step, steps: [step], parts: [makePart()], lots: [makeLot({ status: 'pending' })] })?.code ===
      'pending',
    '待核批号拒绝继续领用',
  );
}

// 场景7：改用量投影校验（占用 1 + 改到 3，容量 2 -> 差 1）
{
  const doneStep = makeStep({ state: 'done', partIds: ['p1', 'p2'] });
  const parts = [makePart({ id: 'p1', qtyNeeded: 1 }), makePart({ id: 'p2', clockId: 'c2', qtyNeeded: 1 })];
  const projected = parts.map((p) => (p.id === 'p1' ? { ...p, qtyNeeded: 3 } : p));
  const { occupancy } = evaluateLedger({ steps: [doneStep], parts: projected, lots: [makeLot({ capacity: 2 })] });
  assert(shortageOf(occupancy)[0]?.short === 2, '占用 4 vs 容量 2：还差 2');
}

// 场景8：非装配工序不占用
{
  const step = makeStep({ stepType: '清洗', state: 'done' });
  const { entries } = evaluateLedger({ steps: [step], parts: [makePart()], lots: [makeLot()] });
  assert(entries.length === 0, '清洗工序不占批号');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
