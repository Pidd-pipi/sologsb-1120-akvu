/** 钟表种类 */
export type ClockKind = '座钟' | '挂钟' | '怀表' | '皮筒钟' | '塔钟';

export const CLOCK_KINDS: ClockKind[] = ['座钟', '挂钟', '怀表', '皮筒钟', '塔钟'];

/** 品相等级 */
export type ConditionGrade = '一级' | '二级' | '三级' | '待修';

export const CONDITION_GRADES: ConditionGrade[] = ['一级', '二级', '三级', '待修'];

/** 修复状态（用于台账分栏） */
export type RepairState = '未开工' | '维修中' | '待测试' | '已完成';

/** 古董钟表 */
export interface Clock {
  id: string;
  /** 藏品号 */
  clockNo: string;
  kind: ClockKind;
  /** 机芯型号 */
  caliber: string;
  /** 国别 */
  origin: string;
  maker: string;
  /** 年代 */
  yearMade: string;
  caseMaterial: string;
  /** 尺寸 mm */
  size: string;
  /** 盘面标识 */
  dialMark: string;
  acquireFrom: string;
  conditionGrade: ConditionGrade;
  /** 存放位置 */
  storagePos: string;
  createdAt: number;
}

export type ClockDraft = Omit<Clock, 'id' | 'createdAt'>;
