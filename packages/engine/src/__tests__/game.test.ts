import { describe, expect, it } from 'vitest';
import {
  autoRelocateMove,
  assignRandomSymbols,
  assignSymbols,
  clearPremove,
  cloneState,
  consumePremove,
  createGame,
  loserOf,
  placeMove,
  resign,
  scoreResult,
  serializeState,
  setPremove,
} from '../game.js';
import { resolveRule } from '../rules.js';
import type { GameState } from '../types.js';

const now = 1_700_000_000_000;

describe('assignRandomSymbols', () => {
  const players = [{ userId: 'u1', username: 'alice' }, { userId: 'u2', username: 'bob' }];

  it('chọn ngẫu nhiên người đi trước và gán X/O đúng', () => {
    expect(assignRandomSymbols(players, () => 0.1)).toEqual([
      { ...players[0]!, symbol: 'X' },
      { ...players[1]!, symbol: 'O' },
    ]);
    expect(assignRandomSymbols(players, () => 0.9)).toEqual([
      { ...players[1]!, symbol: 'X' },
      { ...players[0]!, symbol: 'O' },
    ]);
  });

  it('không thay đổi danh sách đầu vào', () => {
    assignRandomSymbols(players, () => 0.9);
    expect(players.map((p) => p.userId)).toEqual(['u1', 'u2']);
  });

  it('yêu cầu đúng hai người chơi', () => {
    expect(() => assignRandomSymbols([{ userId: 'u1' }])).toThrow('exactly two players');
  });
});

describe('assignSymbols — người thua ván trước được đi trước', () => {
  const players = [{ userId: 'u1', username: 'alice' }, { userId: 'u2', username: 'bob' }];

  it('người được chỉ định luôn đi trước (ký hiệu X), bất kể rng', () => {
    for (const rng of [() => 0.1, () => 0.9]) {
      expect(assignSymbols(players, 'u2', rng)).toEqual([
        { ...players[1]!, symbol: 'X' },
        { ...players[0]!, symbol: 'O' },
      ]);
    }
  });

  it('không người chơi nào hợp lệ thì rơi về ngẫu nhiên', () => {
    expect(assignSymbols(players, 'khong-ton-tai', () => 0.1)).toEqual([
      { ...players[0]!, symbol: 'X' },
      { ...players[1]!, symbol: 'O' },
    ]);
  });

  it('null (ván đầu / ván trước hoà) thì chọn ngẫu nhiên như cũ', () => {
    expect(assignSymbols(players, null, () => 0.9)).toEqual([
      { ...players[1]!, symbol: 'X' },
      { ...players[0]!, symbol: 'O' },
    ]);
  });

  it('loserOf trả về người thua, còn hoà thì giữ người đi trước cũ', () => {
    const state = { winnerId: 'u1', players: [{ userId: 'u1' }, { userId: 'u2' }] } as never;
    expect(loserOf(state)).toBe('u2');
    expect(loserOf({ winnerId: null, players: [{ userId: 'u1' }, { userId: 'u2' }] } as never, 'u2')).toBe('u2');
    expect(loserOf({ winnerId: null, players: [{ userId: 'u1' }, { userId: 'u2' }] } as never)).toBeNull();
  });
});

function twoPlayerGame(tier: 'classic' | 'big' | 'infinity' = 'classic'): GameState {
  return createGame({
    matchId: 'm1',
    code: 'ABC234',
    rule: resolveRule({ tier }),
    players: [
      { userId: 'u1', username: 'alice', symbol: 'X' },
      { userId: 'u2', username: 'bob', symbol: 'O' },
    ],
    startedAt: now,
  });
}

const play = (s: GameState, userId: string, x: number, y: number) =>
  placeMove(s, { playerId: userId, x, y, at: now });

describe('createGame', () => {
  it('X đi trước, board rỗng, seq = 0', () => {
    const g = twoPlayerGame();
    expect(g.turn).toBe('u1');
    expect(g.status).toBe('playing');
    expect(g.seq).toBe(0);
    expect(Object.keys(g.board)).toHaveLength(0);
  });
});

describe('placeMove — luồng cơ bản', () => {
  it('đi đúng lượt, seq tăng, quay lượt', () => {
    let g = twoPlayerGame();
    const r1 = play(g, 'u1', 0, 0);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.move.seq).toBe(1);
    expect(r1.state.turn).toBe('u2');
    expect(r1.state.players.find((p) => p.userId === 'u1')?.stones).toBe(1);

    const r2 = play(r1.state, 'u2', 1, 0);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.turn).toBe('u1');
    expect(r2.state.moves).toHaveLength(2);
  });

  it('không cho đi khi chưa tới lượt', () => {
    const g = twoPlayerGame();
    expect(play(g, 'u2', 0, 0)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('không cho người ngoài cuộc đánh', () => {
    const g = twoPlayerGame();
    expect(play(g, 'hacker', 0, 0)).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
  });

  it('không cho đánh ô đã có quân', () => {
    let g = twoPlayerGame();
    const r = play(g, 'u1', 1, 1);
    if (!r.ok) throw new Error('setup failed');
    g = r.state;
    const r2 = play(g, 'u2', 1, 1);
    expect(r2).toEqual({ ok: false, error: 'occupied' });
  });

  it('không cho đánh sau khi ván kết thúc', () => {
    let g = twoPlayerGame();
    const seqOf = (cells: Array<[string, number, number]>) => {
      for (const [u, x, y] of cells) {
        const r = play(g, u, x, y);
        if (!r.ok) throw new Error(`setup failed: ${r.error}`);
        g = r.state;
      }
      return g;
    };
    g = seqOf([
      ['u1', 0, 0], ['u2', 1, 1],
      ['u1', 1, 0], ['u2', 2, 1],
      ['u1', 2, 0],
    ]);
    expect(g.status).toBe('finished');
    expect(g.winnerId).toBe('u1');
    expect(play(g, 'u2', 2, 2)).toEqual({ ok: false, error: 'GAME_NOT_PLAYING' });
  });

  it('không mutate state cũ', () => {
    const g = twoPlayerGame();
    const r = play(g, 'u1', 0, 0);
    expect(g.seq).toBe(0);
    expect(Object.keys(g.board)).toHaveLength(0);
    if (r.ok) expect(r.state.seq).toBe(1);
  });
});

describe('phát hiện thắng', () => {
  it('thắng 3×3 theo cột', () => {
    let g = twoPlayerGame();
    for (const [u, x, y] of [
      ['u1', 0, 0], ['u2', 1, 1], ['u1', 0, 1], ['u2', 2, 2], ['u1', 0, 2],
    ] as Array<[string, number, number]>) {
      const r = play(g, u, x, y);
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.status).toBe('finished');
    expect(g.winnerId).toBe('u1');
    expect(g.reason).toBe('win');
    expect(g.winningLine).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
    expect(g.turn).toBeNull();
  });

  it('thắng 6×6 với 4 quân', () => {
    let g = twoPlayerGame('big');
    const moves: Array<[string, number, number]> = [
      ['u1', 5, 0], ['u2', 4, 0], ['u1', 5, 1], ['u2', 4, 1],
      ['u1', 5, 2], ['u2', 4, 2], ['u1', 5, 3],
    ];
    for (const [u, x, y] of moves) {
      const r = play(g, u, x, y);
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.winnerId).toBe('u1');
    expect(g.winningLine).toHaveLength(4);
  });

  it('bàn 3×3 đầy mà không ai thắng → hoà', () => {
    let g = twoPlayerGame();
    const moves: Array<[string, number, number]> = [
      ['u1', 0, 0], ['u2', 1, 0], ['u1', 2, 0],
      ['u2', 0, 1], ['u1', 1, 1], ['u2', 2, 2],
      ['u1', 1, 2], ['u2', 0, 2], ['u1', 2, 1],
    ];
    for (const [u, x, y] of moves) {
      const r = play(g, u, x, y);
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.status).toBe('finished');
    expect(g.winnerId).toBeNull();
    expect(g.reason).toBe('draw');
  });

  it('bàn vô hạn thắng với 5 quân liền kề', () => {
    let g = twoPlayerGame('infinity');
    // X đánh (0,0); O đánh lệch sang (10,10) sẽ vi phạm luật kề -> dùng ô kề hợp lệ
    const moves: Array<[string, number, number]> = [
      ['u1', 0, 0], ['u2', -1, 0], ['u1', 0, 1], ['u2', -1, 1], ['u1', 0, 2],
      ['u2', -1, 2], ['u1', 0, 3], ['u2', -1, 3], ['u1', 0, 4],
    ];
    for (const [u, x, y] of moves) {
      const r = play(g, u, x, y);
      if (!r.ok) throw new Error(`nước ${u} (${x},${y}) bị từ chối: ${r.error}`);
      g = r.state;
    }
    expect(g.winnerId).toBe('u1');
    expect(g.winningLine).toHaveLength(5);
  });
});

describe('luật bàn vô hạn trong game', () => {
  it('nước đầu ở mọi vị trí nguyên đều hợp lệ', () => {
    const g = twoPlayerGame('infinity');
    const result = play(g, 'u1', 3, 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.board['3,3']).toBe('X');
  });

  it('quân ở xa tuỳ ý được chấp nhận', () => {
    const g = twoPlayerGame('infinity');
    const r = play(g, 'u1', 3, 3);
    if (!r.ok) throw new Error('setup');
    const far = play(r.state, 'u2', 50, -200);
    expect(far.ok).toBe(true);
    if (far.ok) expect(far.state.board['50,-200']).toBe('O');
  });
});

describe('pre-move', () => {
  it('từ chối khi tắt pre-move', () => {
    const g = createGame({
      matchId: 'm1',
      code: 'AAA111',
      rule: resolveRule({ tier: 'classic' }),
      players: [{ userId: 'u1', username: 'a', symbol: 'X' }, { userId: 'u2', username: 'b', symbol: 'O' }],
      premoveEnabled: false,
    });
    const r = setPremove(g, 'u1', [{ x: 0, y: 0 }]);
    expect(r).toEqual({ ok: false, error: 'PREMOVE_DISABLED' });
  });

  it('từ chối quá 3 nước', () => {
    const g = twoPlayerGame();
    const r = setPremove(g, 'u1', [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 },
    ]);
    expect(r).toEqual({ ok: false, error: 'PREMOVE_FULL' });
  });

  it('từ chối ô trùng nhau', () => {
    const g = twoPlayerGame();
    expect(setPremove(g, 'u1', [{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual({
      ok: false,
      error: 'PREMOVE_DUPLICATE',
    });
  });

  it('lưu tối đa 3 nước theo thứ tự', () => {
    const g = twoPlayerGame();
    const r = setPremove(g, 'u1', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.userId === 'u1')?.premove).toHaveLength(3);
  });

  it('consumePremove tự đánh nước đầu tiên và chuyển lượt', () => {
    let g = twoPlayerGame();
    let r = setPremove(g, 'u1', [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    if (!r.ok) throw new Error('setup');
    g = r.state;

    const consumed = consumePremove(g, 'u1', now);
    expect(consumed.status).toBe('played');
    if (consumed.status !== 'played' || !consumed.result.ok) return;
    g = consumed.result.state;

    expect(g.board['0,0']).toBe('X');
    expect(g.turn).toBe('u2');
    // Hàng đợi còn lại 1 nước cho u1, nhưng chưa tới lượt
    expect(g.players.find((p) => p.userId === 'u1')?.premove).toHaveLength(1);
  });

  it('nước đi trước bị chặn → hủy, không tự dời', () => {
    let g = twoPlayerGame();
    // u1 xếp quân ở (1,1) trong lượt của u2; u2 chiếm mất ô đó
    let r1 = play(g, 'u1', 0, 0);
    if (!r1.ok) throw new Error('setup');
    g = r1.state;
    let queued = setPremove(g, 'u1', [{ x: 1, y: 1 }]);
    if (!queued.ok) throw new Error('setup');
    g = queued.state;
    let r2 = play(g, 'u2', 1, 1);
    if (!r2.ok) throw new Error('setup');
    g = r2.state;
    const consumed = consumePremove(g, 'u1', now);
    expect(consumed.status).toBe('cancelled');
    if (consumed.status !== 'cancelled') return;
    expect(consumed.cell).toEqual({ x: 1, y: 1 });
    expect(consumed.state.turn).toBe('u1');
    expect(consumed.state.players.find((p) => p.userId === 'u1')?.premove).toHaveLength(0);
    expect(consumed.state.board['1,1']).toBe('O');
  });

  it('autoRelocate đánh hộ ô hợp lệ gần nhất', () => {
    let g = twoPlayerGame();
    const r1 = play(g, 'u1', 0, 0);
    if (!r1.ok) throw new Error('setup');
    g = r1.state;
    const r2 = play(g, 'u2', 1, 1);
    if (!r2.ok) throw new Error('setup');
    g = r2.state;
    // u1 muốn đánh (1,1) nhưng đã bị chiếm
    const alt = autoRelocateMove(g, 'u1', { x: 1, y: 1 }, now);
    expect(alt).not.toBeNull();
    if (!alt || !alt.ok) return;
    expect(alt.move.source).toBe('auto');
    expect(alt.move.x).toBeGreaterThanOrEqual(0);
    expect(alt.move.x).toBeLessThan(3);
    expect(alt.move.y).toBeGreaterThanOrEqual(0);
    expect(alt.move.y).toBeLessThan(3);
    expect(`${alt.move.x},${alt.move.y}`).not.toBe('1,1');
  });

  it('clearPremove xoá sạch hàng đợi', () => {
    let g = twoPlayerGame();
    const r = setPremove(g, 'u1', [{ x: 1, y: 1 }]);
    if (!r.ok) throw new Error('setup');
    g = clearPremove(r.state, 'u1');
    expect(g.players.find((p) => p.userId === 'u1')?.premove).toEqual([]);
  });

  it('đánh tay xoá hàng đợi của mình nhưng giữ hàng đợi đối thủ', () => {
    let g = twoPlayerGame();
    const r1 = setPremove(g, 'u1', [{ x: 0, y: 0 }]);
    if (!r1.ok) throw new Error('setup');
    const r2 = setPremove(r1.state, 'u2', [{ x: 2, y: 2 }]);
    if (!r2.ok) throw new Error('setup');
    const r3 = play(r2.state, 'u1', 1, 1);
    if (!r3.ok) throw new Error('setup');
    expect(r3.state.players.find((p) => p.userId === 'u1')?.premove).toEqual([]);
    expect(r3.state.players.find((p) => p.userId === 'u2')?.premove).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('kết thúc ván', () => {
  it('bỏ cuộc → đối thủ thắng', () => {
    const g = resign(twoPlayerGame(), 'u1');
    expect(g.status).toBe('finished');
    expect(g.winnerId).toBe('u2');
    expect(g.reason).toBe('resign');
  });

  it('tính điểm khi ván vô hạn kết thúc do hết giờ', () => {
    const g = scoreResult(twoPlayerGame('infinity'), 'u1', 'timeout');
    expect(g.reason).toBe('timeout');
    expect(g.winnerId).toBe('u1');
  });
});

describe('cloneState / serializeState', () => {
  it('clone sâu, không chia sẻ tham chiếu', () => {
    const g = twoPlayerGame();
    const r = setPremove(g, 'u1', [{ x: 1, y: 1 }]);
    if (!r.ok) throw new Error('setup');
    const copy = cloneState(r.state);
    copy.players[0]!.premove[0]!.x = 99;
    expect(r.state.players[0]!.premove[0]!.x).toBe(1);
  });

  it('serialize ra dạng phẳng cho client', () => {
    const g = twoPlayerGame();
    const r = play(g, 'u1', 2, 1);
    if (!r.ok) throw new Error('setup');
    const s = serializeState(r.state);
    expect(s.board).toEqual([{ x: 2, y: 1, symbol: 'X' }]);
    expect(s.players).toHaveLength(2);
    expect(s.rule.winLength).toBe(3);
  });
});
