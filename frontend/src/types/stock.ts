/** 批号库存状态：正常 / 待核（旧数据回填，数量待核） */
export type StockStatus = 'normal' | 'pending';

/** 批号库存台账：一个批号一条入库账 */
export interface Stock {
  id: string;
  /** 来源批号 */
  lot: string;
  /** 入库总数；待核记录为按已用量回填的占位数量 */
  qtyTotal: number;
  status: StockStatus;
  note: string;
}

/** 领用账：完成工序时按零件实际用量占用批号数量，把零件、工序、钟表接成一张账 */
export interface Claim {
  id: string;
  lot: string;
  partId: string;
  stepId: string;
  clockId: string;
  /** 实际占用数量 = 零件 qtyNeeded */
  qty: number;
  claimedAt: number;
}

/** 领用账错误：容量不足 / 无来源批号等，事务回滚并抛出 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}
