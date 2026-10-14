/**
 * Quét tham số: tự đấu giữa các hồ sơ AI khác nhau để chọn cấu hình mạnh nhất.
 * Chạy: npx tsx packages/engine/scripts/sweep.ts <tier> <so-van>
 */
import { chooseBotMoveWithProfile, profileFor, type AiProfile } from '../src/ai.js';
import { findWinningLine, setStone } from '../src/board.js';
import { legalMoves } from '../src/ai.js';
import { resolveRule } from '../src/rules.js';
import type { BoardRule, Symbol } from '../src/types.js';

const mulberry = (seed: number) => () => {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const play = (rule: BoardRule, a: AiProfile, b: AiProfile, seedA: () => number, seedB: () => number): Symbol | 'draw' => {
  let board: Record<string, Symbol> = {};
  let turn: Symbol = 'X';
  for (let ply = 0; ply < 80; ply += 1) {
    const isX = turn === 'X';
    const mv = chooseBotMoveWithProfile(board, rule, turn, isX ? a : b, isX ? seedA : seedB, {}, false);
    if (!mv) return 'draw';
    board = setStone(board, mv.x, mv.y, turn);
    if (findWinningLine(board, rule, turn, mv.x, mv.y)) return turn;
    if (legalMoves(board, rule).length === 0) return 'draw';
    turn = isX ? 'O' : 'X';
  }
  return 'draw';
};

const tier = (process.argv[2] ?? 'big') as 'classic' | 'big' | 'infinity';
const N = Number(process.argv[3] ?? 12);
const rule = resolveRule({ tier });

const combos: Array<{ label: string; profile: AiProfile }> = [
  { label: 'normal(d5,b16)', profile: profileFor('normal') },
  { label: 'd5-b22', profile: { depth: 5, timeMs: 700, branching: 22, blunderChance: 0 } },
  { label: 'd6-b16', profile: { depth: 6, timeMs: 700, branching: 16, blunderChance: 0 } },
  { label: 'd6-b22', profile: { depth: 6, timeMs: 700, branching: 22, blunderChance: 0 } },
  { label: 'd8-b22', profile: { depth: 8, timeMs: 700, branching: 22, blunderChance: 0 } },
  { label: 'd8-b14', profile: { depth: 8, timeMs: 700, branching: 14, blunderChance: 0 } },
];

const baseline = profileFor('normal');
for (const { label, profile } of combos) {
  let win = 0;
  let loss = 0;
  let draw = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i += 1) {
    const asX = i % 2 === 0;
    const winner = play(
      rule,
      asX ? profile : baseline,
      asX ? baseline : profile,
      mulberry(i * 13 + 3),
      mulberry(i * 17 + 991),
    );
    if (winner === 'draw') draw += 1;
    else if ((winner === 'X') === asX) win += 1;
    else loss += 1;
  }
  console.log(`[${tier}] ${label} vs normal: ${win}W ${loss}L ${draw}D (${Date.now() - t0}ms)`);
}