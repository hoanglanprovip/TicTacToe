import { chooseBotMove, legalMoves, type Difficulty } from '../src/ai.js';
import { findWinningLine, setStone } from '../src/board.js';
import { resolveRule } from '../src/rules.js';
import type { BoardRule, Symbol } from '../src/types.js';

const playGame = (
  rule: BoardRule,
  xSide: Difficulty,
  oSide: Difficulty,
  seed: () => number,
): Symbol | 'draw' => {
  let board: Record<string, Symbol> = {};
  let turn: Symbol = 'X';
  for (let ply = 0; ply < 80; ply += 1) {
    const mover = turn === 'X' ? xSide : oSide;
    const move = chooseBotMove(board, rule, turn, mover, seed);
    if (!move) return 'draw';
    board = setStone(board, move.x, move.y, turn);
    if (findWinningLine(board, rule, turn, move.x, move.y)) return turn;
    if (legalMoves(board, rule).length === 0) return 'draw';
    turn = turn === 'X' ? 'O' : 'X';
  }
  return 'draw';
};

const mulberry = (seed: number) => () => {
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const tier = (process.argv[2] ?? 'classic') as 'classic' | 'big' | 'infinity';
const games = Number(process.argv[3] ?? 20);
const rule = resolveRule({ tier });

const pairs: Array<[Difficulty, Difficulty]> = [
  ['hard', 'easy'],
  ['hard', 'normal'],
  ['normal', 'easy'],
];

for (const [strong, weak] of pairs) {
  let strongWins = 0;
  let weakWins = 0;
  let draws = 0;
  const t0 = Date.now();
  for (let i = 0; i < games; i += 1) {
    const strongIsX = mulberry(i + 101)() < 0.5;
    const winner = playGame(rule, strongIsX ? strong : weak, strongIsX ? weak : strong, mulberry(i * 37 + 5));
    if (winner === 'draw') draws += 1;
    else if ((winner === 'X') === strongIsX) strongWins += 1;
    else weakWins += 1;
  }
  console.log(
    `[${tier}] ${strong} vs ${weak}: thang ${strongWins} — thua ${weakWins} — hoa ${draws} (${Date.now() - t0}ms / ${games} van)`,
  );
}