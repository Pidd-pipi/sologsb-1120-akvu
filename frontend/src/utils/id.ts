/** 生成本地唯一 id */
export function newId(prefix = 'id'): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}${rand}`;
}

/** 下一个顺序号 */
export function nextSeq(existing: number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

/** 检查顺序号缺失项 */
export function findSeqGaps(seqs: number[]): number[] {
  if (seqs.length === 0) return [];
  const max = Math.max(...seqs);
  const set = new Set(seqs);
  const gaps: number[] = [];
  for (let i = 1; i <= max; i += 1) {
    if (!set.has(i)) gaps.push(i);
  }
  return gaps;
}
