/** 零件名称 */
export type PartName =
  | '条盒轮'
  | '二轮'
  | '擒纵轮'
  | '擒纵叉'
  | '摆轮'
  | '发条'
  | '宝石轴承'
  | '螺丝';

export const PART_NAMES: PartName[] = [
  '条盒轮',
  '二轮',
  '擒纵轮',
  '擒纵叉',
  '摆轮',
  '发条',
  '宝石轴承',
  '螺丝',
];

/** 磨损状态 */
export type WearState = '完好' | '磨损' | '断裂' | '锈蚀';

export const WEAR_STATES: WearState[] = ['完好', '磨损', '断裂', '锈蚀'];

/** 处理决定 */
export type PartDecision = '保留' | '修配' | '换新';

export const PART_DECISIONS: PartDecision[] = ['保留', '修配', '换新'];

/** 机芯零件 */
export interface MovementPart {
  id: string;
  clockId: string;
  name: PartName;
  /** 需要数量 */
  qtyNeeded: number;
  /** 装配位置 */
  position: string;
  wearState: WearState;
  decision: PartDecision;
  /** 配换来源批号 */
  sourceLot: string;
  /** 关键尺寸 mm */
  dimension: number;
}

export type MovementPartDraft = Omit<MovementPart, 'id'>;

/** 是否待修配（磨损且未换新） */
export function needsRepair(part: MovementPart): boolean {
  return part.decision !== '保留' && part.wearState !== '完好';
}
