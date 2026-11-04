/* ============ 確定性偽隨機（鐵律 2：禁 Math.random，一切隨機感由索引+種子算出） ============ */

/** 字串 → 32 位整數種子 */
export function strSeed(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 種子 → [0,1) 確定性雜湊 */
export function hash01(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

/** 第 i 個元素的確定性隨機（常用於錯落節奏） */
export function pick01(baseSeed: number, index: number): number {
  return hash01((baseSeed + index * 97) >>> 0)
}
