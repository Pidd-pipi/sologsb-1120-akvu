import Dexie, { type Table } from 'dexie';
import type { Clock } from '../types/clock';
import type { PartLot } from '../types/lot';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';
import type { TimekeepingTest } from '../types/test';
import { newId } from './id';

export const DB_NAME = 'gbclockrepair';
export const DB_VERSION = 3;
export const LS_VERSION_KEY = 'gbclockrepair:db-version';

export class ClockRepairDB extends Dexie {
  clocks!: Table<Clock, string>;
  parts!: Table<MovementPart, string>;
  lots!: Table<PartLot, string>;
  steps!: Table<RepairStep, string>;
  tests!: Table<TimekeepingTest, string>;

  constructor(name: string = DB_NAME) {
    super(name);
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
    // v3：新增批号库存表，把旧零件的来源批号按已用量回填为「待核」库存
    this.version(3)
      .stores({
        clocks: 'id, clockNo, kind, caliber, conditionGrade, createdAt',
        parts: 'id, clockId, name, wearState, decision, sourceLot',
        lots: 'id, lotNo, partName, status',
        steps: 'id, clockId, seq, stepType, state, startedAt',
        tests: 'id, clockId, testedAt, conclusion',
      })
      .upgrade(async (tx) => {
        const oldParts = (await tx.table('parts').toArray()) as MovementPart[];
        // 仅为配换零件（非保留）且登记过批号的旧记录建库存；空批号旧记录不当可用
        const byLot = new Map<string, { partName: MovementPart['name']; qty: number }>();
        for (const p of oldParts) {
          const lotNo = (p.sourceLot ?? '').trim();
          if (!lotNo || p.decision === '保留') continue;
          const cur = byLot.get(lotNo);
          if (cur) cur.qty += p.qtyNeeded || 0;
          else byLot.set(lotNo, { partName: p.name, qty: p.qtyNeeded || 0 });
        }
        if (byLot.size > 0) {
          const now = Date.now();
          const lots: PartLot[] = Array.from(byLot.entries()).map(([lotNo, v]) => ({
            id: newId('lot'),
            lotNo,
            partName: v.partName,
            capacity: v.qty,
            status: 'pending',
            note: '旧档案迁移：按已登记用量回填，余量为 0，待核账',
            createdAt: now,
          }));
          await tx.table('lots').bulkPut(lots);
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

  const partSpring = newId('prt');
  const partJewel = newId('prt');
  const partBalance = newId('prt');
  const partSpringB = newId('prt');
  const partEscape = newId('prt');

  const parts: MovementPart[] = [
    {
      id: partSpring,
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
      id: partJewel,
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
      id: partBalance,
      clockId: clockB,
      name: '摆轮',
      qtyNeeded: 1,
      position: '摆轮夹板下',
      wearState: '完好',
      decision: '保留',
      sourceLot: '',
      dimension: 14.5,
    },
    {
      id: partSpringB,
      clockId: clockB,
      name: '发条',
      qtyNeeded: 1,
      position: '条盒内',
      wearState: '锈蚀',
      decision: '换新',
      // 与 clockA 的新发条同一批号：两台钟抢同一批库存
      sourceLot: 'MS-2024-07',
      dimension: 0.35,
    },
    // 无批号来源的换新件：完成装配时必须拒绝，不能当作有库存
    {
      id: partEscape,
      clockId: clockB,
      name: '擒纵轮',
      qtyNeeded: 1,
      position: '四轮夹板下',
      wearState: '断裂',
      decision: '换新',
      sourceLot: '',
      dimension: 8.2,
    },
  ];

  const lots: PartLot[] = [
    {
      id: newId('lot'),
      lotNo: 'MS-2024-07',
      partName: '发条',
      capacity: 1,
      status: 'verified',
      note: '同批仅余 1 枚发条：两台钟各领 1 枚时，只有先完成装配的一方成功',
      createdAt: now - 30 * day,
      verifiedAt: now - 30 * day,
    },
    {
      id: newId('lot'),
      lotNo: 'JWL-18',
      partName: '宝石轴承',
      capacity: 12,
      status: 'verified',
      note: '18 号红宝石轴承批',
      createdAt: now - 30 * day,
      verifiedAt: now - 30 * day,
    },
  ];

  const steps: RepairStep[] = [
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '拆解',
      seq: 1,
      partIds: [partSpring],
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
      partIds: [partJewel],
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
      partIds: [partJewel],
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
    {
      id: newId('stp'),
      clockId: clockA,
      stepType: '装配',
      seq: 4,
      partIds: [partSpring, partJewel],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: 'Moebius 9501',
      oilPoints: '条盒轴、上条柄',
      torque: 0.4,
      troubleNote: '',
      operator: '祁仲言',
      startedAt: now - 2 * day,
      state: 'pending',
    },
    {
      id: newId('stp'),
      clockId: clockB,
      stepType: '装配',
      seq: 1,
      partIds: [partBalance, partSpringB, partEscape],
      cleanSolvent: '',
      cleanMethod: '',
      oilType: 'Moebius 9010',
      oilPoints: '擒纵轮轴、条盒轴',
      torque: 0.3,
      troubleNote: '擒纵轮待配齐批号；发条与 A 台共用 MS-2024-07',
      operator: '祁仲言',
      startedAt: now - 1 * day,
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

  await db.transaction('rw', db.clocks, db.parts, db.lots, db.steps, db.tests, async () => {
    await db.clocks.bulkPut(clocks);
    await db.parts.bulkPut(parts);
    await db.lots.bulkPut(lots);
    await db.steps.bulkPut(steps);
    await db.tests.bulkPut(tests);
  });
}
