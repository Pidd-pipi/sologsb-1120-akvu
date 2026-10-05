import type { PartName } from './part';

/** 批号库存状态：在册（已核账可领用）/ 待核（旧数据按已用量回填，余量为 0） */
export type LotStatus = 'verified' | 'pending';

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  verified: '在册',
  pending: '待核',
};

/** 来源批号库存（一张批号对应一种零件） */
export interface PartLot {
  id: string;
  /** 来源批号 */
  lotNo: string;
  /** 批号内零件名称 */
  partName: PartName;
  /** 批号容量（总件数） */
  capacity: number;
  status: LotStatus;
  /** 备注（旧数据回填时记录来源） */
  note: string;
  createdAt: number;
  /** 核账时间 */
  verifiedAt?: number;
}

export type PartLotDraft = Omit<PartLot, 'id' | 'createdAt'>;
