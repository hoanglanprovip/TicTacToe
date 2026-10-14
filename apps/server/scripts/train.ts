/**
 * Train bot ngoại tuyến: cho máy tự đấu chính nó rồi tự rút kinh nghiệm.
 *
 *   npm run train -- --games=500 --tier=classic --level=hard --opponent=easy
 *
 * Kết quả lưu vào data/game.json (cùng nơi lưu não bot lúc chơi thật),
 * nên bot đọc được kinh nghiệm này ngay ở các ván sau.
 */
import { runTraining } from '../src/trainer.js';

const arg = (name: string, fallback: string) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=')[1]! : fallback;
};

const result = runTraining({
  games: Number(arg('games', '500')),
  tier: arg('tier', 'classic'),
  level: arg('level', 'hard'),
  opponent: arg('opponent', 'easy'),
  seed: Number(arg('seed', '20240')),
});

console.log(`Xong ${result.games} van (${result.tier}, theo ${result.level}) trong ${(result.tookMs / 1000).toFixed(1)}s`);
console.log(`  Ket qua tu dan: thang ${result.results.win} / thua ${result.results.loss} / hoa ${result.results.draw}`);
console.log(`  Tong: ${result.stats.games} van (thang ${result.stats.wins} / thua ${result.stats.losses} / hoa ${result.stats.draws})`);
console.log(`  Bai hoc: ${result.stats.lessons} · Cap do: ${result.stats.level} · XP: ${result.stats.xp}`);