/**
 * Nạp cấu hình từ file .env mà không cần thêm thư viện.
 * - Biến đã có trong process.env luôn được ưu tiên (để chạy nhanh bằng lệnh).
 * - Nạp từ: <thư mục gốc dự án>/.env rồi tới apps/server/.env.
 * - Bỏ qua dòng comment (#), dòng trống; hỗ trợ `KEY=value` và `export KEY=value`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// dist/ hoặc src/ → lên 3 cấp tới gốc dự án
const projectRoot = resolve(here, '../../..');

const candidates = [resolve(projectRoot, '.env'), resolve(here, '../.env')];

const parse = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
};

export function loadEnv(): Record<string, string> {
  let applied: Record<string, string> = {};
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = parse(readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
          applied[key] = value;
        }
      }
    } catch {
      /* file .env hỏng thì bỏ qua, vẫn chạy được bằng biến môi trường */
    }
  }
  return applied;
}