import { chooseBotMove, rankMoves, profileFor, winningMoves } from '../src/ai.js';
import { setStone } from '../src/board.js';
import { resolveRule } from '../src/rules.js';
import type { Symbol } from '../src/types.js';

const build = (cells: Array<[number, number, Symbol]>) => {
  let b: Record<string, Symbol> = {};
  for (const [x, y, s] of cells) b = setStone(b, x, y, s);
  return b;
};
const at = (m: { x: number; y: number } | null) => (m ? `${m.x},${m.y}` : null);

const classic = resolveRule({ tier: 'classic' });
const big = resolveRule({ tier: 'big' });

const t3 = resolveRule({ tier: 'big' });
const board1 = build([[0, 0, 'X'], [1, 0, 'X'], [2, 0, 'X'], [0, 1, 'O'], [1, 1, 'O']]);
console.log('--- test 6x6 block ---');
console.log('wins for X:', winningMoves(board1, t3, 'X').map(at));
console.log('ranked O:', rankMoves(board1, t3, 'O', profileFor('hard')).slice(0, 6).map((r) => `${at(r.cell)}=${Math.round(r.score)}`));
console.log('choose:', at(chooseBotMove(board1, big, 'O', 'hard')));

const empty = {};
console.log('--- empty 3x3 ---');
console.log('ranked:', rankMoves(empty, classic, 'X', profileFor('hard')).map((r) => `${at(r.cell)}=${Math.round(r.score)}`));
console.log('choose:', at(chooseBotMove(empty, classic, 'X', 'hard')));

const b3 = build([[0, 0, 'X'], [0, 2, 'X'], [2, 0, 'O'], [1, 1, 'O'], [2, 2, 'O']]);
console.log('--- win now ---');
console.log('wins for X:', winningMoves(b3, classic, 'X').map(at));
console.log('ranked:', rankMoves(b3, classic, 'X', profileFor('hard')).slice(0, 4).map((r) => `${at(r.cell)}=${Math.round(r.score)}`));
console.log('choose:', at(chooseBotMove(b3, classic, 'X', 'hard')));