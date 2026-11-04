'use strict';

/**
 * kv.js — Vercel KV（Upstash Redis REST）的極簡 client
 *
 * 用途：好話牆 / 排行榜的匿名公開資料（貼文、鼓勵、分數）。
 * 設定：在 Vercel 後台建立 KV store 並連結到專案後，Vercel 會自動注入
 *   KV_REST_API_URL / KV_REST_API_TOKEN —— 不需要把任何 key 寫進 repo。
 *
 * 重要：沒設定 KV 時 enabled() === false，呼叫端必須優雅降級
 * （好話牆退回「只看自己瀏覽器的紀錄」，網站其餘功能完全不受影響）。
 */

function kvUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
}

function kvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
}

function enabled() {
  return Boolean(kvUrl() && kvToken());
}

/**
 * 送一條 Redis command。Vercel KV REST：
 *   POST {KV_REST_API_URL}  Authorization: Bearer {token}
 *   body = JSON.stringify(["SET","k","v"])  →  { "result": ... }
 */
async function cmd(...args) {
  if (!enabled()) return { result: null, error: 'KV not configured' };
  const r = await fetch(kvUrl(), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + kvToken(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error('KV HTTP ' + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error(String(j.error));
  return { result: j && 'result' in j ? j.result : null };
}

// ── 常用命令的薄包裝 ──

async function get(key) {
  const { result } = await cmd('GET', key);
  return result === null || result === undefined ? null : result;
}

async function set(key, val) {
  return (await cmd('SET', key, val)).result;
}

async function incr(key) {
  const { result } = await cmd('INCR', key);
  return Number(result) || 0;
}

async function expire(key, seconds) {
  return (await cmd('EXPIRE', key, String(seconds))).result;
}

async function lpush(key, val) {
  return (await cmd('LPUSH', key, val)).result;
}

async function ltrim(key, start, stop) {
  return (await cmd('LTRIM', key, String(start), String(stop))).result;
}

async function lrange(key, start, stop) {
  const { result } = await cmd('LRANGE', key, String(start), String(stop));
  return Array.isArray(result) ? result : [];
}

async function mget(keys) {
  if (!keys.length) return [];
  const { result } = await cmd('MGET', ...keys);
  return Array.isArray(result) ? result : keys.map(() => null);
}

async function hincrby(key, field, delta) {
  const { result } = await cmd('HINCRBY', key, field, String(delta));
  return Number(result) || 0;
}

/** HGETALL → 回 plain object（Upstash REST 回交錯 array） */
async function hgetall(key) {
  const { result } = await cmd('HGETALL', key);
  const out = {};
  if (Array.isArray(result)) {
    for (let i = 0; i + 1 < result.length; i += 2) out[String(result[i])] = Number(result[i + 1]) || 0;
  } else if (result && typeof result === 'object') {
    for (const [k, v] of Object.entries(result)) out[k] = Number(v) || 0;
  }
  return out;
}

module.exports = {
  enabled,
  cmd,
  get,
  set,
  incr,
  expire,
  lpush,
  ltrim,
  lrange,
  mget,
  hincrby,
  hgetall,
};
