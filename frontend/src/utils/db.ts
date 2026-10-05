import Dexie, { type Table } from 'dexie';
import type { Clock } from '../types/clock';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';
import type { TimekeepingTest } from '../types/test';
import type { Claim, Stock } from '../types/stock';
import { newId } from './id';

export const DB_NAME = 'gbclockrepair';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbclockrepair:db-version';

class ClockRepairDB extends Dexie {
  clocks!: Table<Clock, string>;
  parts!: Table<MovementPart, string>;
  steps!: Table<RepairStep, string>;
  tests!: Table<TimekeepingTest, string>;
  stocks!: Table<Stock, string>;
  claims!: Table<Claim, string>;

  constructor() {
    super(DB_NAME);
    // v1：四张业务表
    this.version(1).stores({
      clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
      parts: 'id, clockId, name, wearState, decision',
      steps: 'id, clockId, seq, stepType, state',
      tests: 'id, clockId, testedAt',
    });
    // v2：补索引并迁移老记录缺省字段
    this.version(2)
      .stores({
        clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
        parts: 'id, clockId, name, wearState, decision, sourceLot',
        steps: 'id, clockId, seq, stepType, state, startedAt',
        tests: 'id, clockId, testedAt, conclusion',
      })
      .upgrade(async (tx) => {
        await tx
          .table('steps')
          .toCollection()
          .modify((row: any) => {
            if (!row.state) row.state = 'pending';
            if (row.partIds === undefined) row.partIds = [];
            if (row.torque === undefined) row.torque = 0;
          });
        await tx
          .table('tests')
          .toCollection()
          .modify((row: any) => {
            if (row.positions === undefined) row.positions = [];
          });
      });
    // v3：批号库存 + 领用账；旧数据按已用量回填待核
    this.version(3)
      .stores({
        clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
        parts: 'id, clockId, name, wearState, decision, sourceLot',
        steps: 'id, clockId, seq, stepType, state, startedAt',
        tests: 'id, clockId, testedAt, conclusion',
        stocks: 'id, lot, status',
        claims: 'id, lot, partId, stepId, clockId',
      })
      .upgrade(async (tx) => {
        const allParts = await tx.table('parts').toArray();
        const allSteps = await tx.table('steps').toArray();
        const doneSteps = allSteps.filter((s: any) => s.state === 'done');
        const referenced = new Set<string>();
        for (const s of doneSteps) for (const pid of s.partIds ?? []) referenced.add(pid);

        const lots = Array.from(
          new Set(
            allParts
              .map((p: any) => (p.sourceLot ?? '').trim())
              .filter((lot: string) => lot.length > 0),
          ),
        );

        for (const lot of lots) {
          const lotParts = allParts.filter((p: any) => (p.sourceLot ?? '').trim() === lot);
          const usedQty = lotParts
            .filter((p: any) => referenced.has(p.id))
            .reduce((sum: number, p: any) => sum + (p.qtyNeeded ?? 0), 0);
          await tx.table('stocks').put({
            id: newId('stk'),
            lot,
            qtyTotal: usedQty,
            status: 'pending',
            note: '旧数据回填，待核',
          } satisfies Stock);

          for (const step of doneSteps) {
            for (const pid of step.partIds ?? []) {
              const part = lotParts.find((p: any) => p.id === pid);
              if (!part) continue;
              if (part.decision === '保留' || part.wearState === '完好') continue;
              await tx.table('claims').put({
                id: newId('clm'),
                lot,
                partId: pid,
                stepId: step.id,
                clockId: step.clockId,
                qty: part.qtyNeeded ?? 0,
                claimedAt: step.finishedAt ?? Date.now(),
              } satisfies Claim);
            }
          }
        }
      });
  }
}

export const db = new ClockRepairDB();

/**
 * 把 Vue 响应式代理（reactive/ref 内部对象，含嵌套数组）转成可结构化克隆的普通对象。
 * IndexedDB 的 put/add 无法克隆 Proxy，否则抛 DataCloneError。
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function markDbVersion(): void {
  try {
    window.localStorage.setItem(LS_VERSION_KEY, String(DB_VERSION));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function readDbVersion(): number {
  try {
    const raw = window.localStorage.getItem(LS_VERSION_KEY);
    return raw ? Number(raw) : DB_VERSION;
  } catch {
    return DB_VERSION;
  }
}

/** 首次进入灌入示范数据，保证页面非空壳 */
export async function ensureSeedData(): Promise<void> {
  const count = await db.clocks.count();
  if (count > 0) return;

  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const clockA = newId('clk');
  const clockB = newId('clk');

  const clocks: Clock[] = [
    {
      id: clockA,
      clockNo: 'CLK-1932-004',
      kind: '座钟',
      caliber: 'Junghans W278',
      origin: '德国',
      maker: 'Junghans',
      yearMade: '1932',
      caseMaterial: '胡桃木壳 + 铜机芯',
      size: '420×260×180',
      dialMark: 'Junghans 八日链，罗马数字盘',
      acquireFrom: '天津藏家转让',
      conditionGrade: '三级',
      storagePos: '修复台 A-2',
      createdAt: now - 20 * day,
    },
    {
      id: clockB,
      clockNo: 'CLK-1890-011',
      kind: '怀表',
      caliber: 'Longines 18.79',
      origin: '瑞士',
      maker: 'Longines',
      yearMade: '1890',
      caseMaterial: '银质猎壳',
      size: '52×18',
      dialMark: '白瓷盘，罗马数字，小秒针',
      acquireFrom: '上海拍卖会',
      conditionGrade: '二级',
      storagePos: '保险柜 B-1',
      createdAt: now - 9 * day,
    },
  ];

  const parts: MovementPart[] = [
    {
      id: newId('prt'),
      clockId: clockA,
      name: '发条',
      qtyNeeded: 1,
      position: '条盒内',
      wearState: '断裂',
      decision: '换新',
      sourceLot: 'MS-2024-07',
      dimension: 0.35,
    },
    {
      id: newId('prt'),
      clockId: clockA,
      name: '宝石轴承',
      qtyNeeded: 4,
      position: '二轮上下轴孔',
      wearState: '磨损',
      decision: '修配',
      sourceLot: 'JWL-18',
      dimension: 1.2,
    },
    {
      id: newId('prt'),
      clockId: clockB,
      name: '摆轮',
      qtyNeeded: 1,
      position: '摆轮夹板下',
      wearState: '完好',
      decision: '保留',
      sourceLot: '',
      dimension: 14.5,
    },
  ];

  const steps: RepairStep[] = [
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '拆解',
      seq: 1,
      partIds: [parts[0].id],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: '',
      oilPoints: '',
      torque: 0.6,
      troubleNote: '条盒盖螺纹轻微锈死，用渗透油浸润后拆下',
      operator: '祁仲言',
      startedAt: now - 12 * day,
      finishedAt: now - 12 * day + 80 * 60000,
      state: 'done',
    },
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '清洗',
      seq: 2,
      partIds: [parts[1].id],
      cleanSolvent: '石油醚 + 无水乙醇',
      cleanMethod: '超声',
      oilType: '',
      oilPoints: '',
      torque: 0,
      troubleNote: '宝石轴承孔内油泥结块，超声 3 遍',
      operator: '祁仲言',
      startedAt: now - 8 * day,
      finishedAt: now - 8 * day + 45 * 60000,
      state: 'done',
    },
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '润滑',
      seq: 3,
      partIds: [parts[1].id],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: 'Moebius 9010',
      oilPoints: '二轮上下轴孔、擒纵叉瓦',
      torque: 0,
      troubleNote: '',
      operator: '祁仲言',
      startedAt: now - 3 * day,
      state: 'pending',
    },
  ];

  const tests: TimekeepingTest[] = [
    {
      id: newId('tst'),
      clockId: clockA,
      testedAt: now - 2 * day,
      amplitude: 262,
      beatError: 0.4,
      rate: 6.5,
      positions: [
        { position: '面上', rate: 5.2, amplitude: 268, beatError: 0.3 },
        { position: '面下', rate: 7.8, amplitude: 256, beatError: 0.5 },
        { position: '12上', rate: 6.1, amplitude: 262, beatError: 0.4 },
        { position: '6上', rate: 6.9, amplitude: 258, beatError: 0.4 },
      ],
      powerReserve: 46,
      conclusion: '合格',
    },
  ];

  // 批号库存：入库总数
  const stocks: Stock[] = [
    { id: newId('stk'), lot: 'MS-2024-07', qtyTotal: 10, status: 'normal', note: '' },
    { id: newId('stk'), lot: 'JWL-18', qtyTotal: 20, status: 'normal', note: '' },
  ];

  // 领用账：已完成工序按零件实际用量占用批号数量
  const claims: Claim[] = [
    {
      id: newId('clm'),
      lot: 'MS-2024-07',
      partId: parts[0].id,
      stepId: steps[0].id,
      clockId: clockA,
      qty: parts[0].qtyNeeded,
      claimedAt: steps[0].finishedAt ?? now,
    },
    {
      id: newId('clm'),
      lot: 'JWL-18',
      partId: parts[1].id,
      stepId: steps[1].id,
      clockId: clockA,
      qty: parts[1].qtyNeeded,
      claimedAt: steps[1].finishedAt ?? now,
    },
  ];

  await db.transaction(
    'rw',
    [db.clocks, db.parts, db.steps, db.tests, db.stocks, db.claims],
    async () => {
      await db.clocks.bulkPut(clocks);
      await db.parts.bulkPut(parts);
      await db.steps.bulkPut(steps);
      await db.tests.bulkPut(tests);
      await db.stocks.bulkPut(stocks);
      await db.claims.bulkPut(claims);
    },
  );
}
