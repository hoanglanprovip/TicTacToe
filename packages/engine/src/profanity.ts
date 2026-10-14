/**
 * Lọc từ cấm cho chat. Có thể dùng chung cho tên tài khoản.
 * Cách làm: chuẩn hoá (bỏ dấu, bỏ ký tự lạ, gộp chữ lặp, đổi leetspeak) rồi so khớp từ.
 */

/**
 * Danh sách từ cấm.
 * Nhóm `strict` = viết tắt 2–3 ký tự, hiệu quả cao, ít khả năng trùng từ thường.
 * Nhóm `contextual` = từ tiếng Việt có dạng đầy đủ, chỉ chặn khi đứng riêng một từ.
 */
const STRICT = ['vl', 'vcl', 'vlcl', 'cl', 'clm', 'dcm', 'dkm', 'dmm', 'deo', 'djt', 'ck'];

/**
 * Từ tiếng Việt đầy đủ, chỉ chặn khi đứng riêng một từ.
 * Cố tình LOẠI những từ quá dễ trùng ngữ cảnh thường: cho, con, đầu, nam, rác…
 */
const CONTEXTUAL = ['me', 'cha', 'ngu', 'diz', 'sua', 'blo', 'tho', 'rac'];

const EN = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'faggot',
  'nigger', 'retard', 'whore', 'slut', 'motherfucker', 'jackass',
];

/** Nguyên âm tiếng Việt hay bị viết tắt bằng ký tự. */
const VN_LOOSE: Array<[RegExp, string]> = [
  [/[đd]/g, 'd'],
  [/ơ/g, 'o'],
  [/ư/g, 'u'],
  [/ê/g, 'e'],
  [/á|à|ả|ã|ạ|â|ấ|ầ|ẩ|ẫ|ậ/g, 'a'],
  [/é|è|ẻ|ẽ|ẹ/g, 'e'],
  [/í|ì|ỉ|ĩ|ị/g, 'i'],
  [/ó|ò|ỏ|õ|ọ|ô|ố|ồ|ổ|ỗ|ộ/g, 'o'],
  [/ú|ù|ủ|ũ|ụ/g, 'u'],
  [/ý|ỳ|ỷ|ỹ|ỵ/g, 'y'],
];

const LEET: Array<[RegExp, string]> = [
  [/0/g, 'o'], [/3/g, 'e'], [/4/g, 'a'], [/5/g, 's'], [/7/g, 't'],
  [/@/g, 'a'], [/\$/g, 's'], [/[!|]/g, 'i'],
];

export function normalize(input: string): string {
  let text = input.toLowerCase();
  for (const [pattern, replacement] of LEET) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of VN_LOOSE) text = text.replace(pattern, replacement);
  // Gộp chữ lặp: "fuuuuck" -> "fuck", "đmmm" -> "dmm", "f*ck" -> "f ck"
  text = text.replace(/(.)\1{2,}/g, '$1');
  return text.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '').trim();
}

const STRICT_SET = new Set(STRICT.map(normalize));
const CONTEXTUAL_SET = new Set(CONTEXTUAL.map(normalize));

/** Từ tiếng Anh đa ký tự cũng cần so khớp cả từ chứa nó: "fucking" -> "fuck" */
const EN_RE = new RegExp(`(${EN.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);

export interface ModerateResult {
  /** Nội dung đã xử lý, an toàn để hiển thị. */
  text: string;
  /** Có nên chặn hẳn tin nhắn không. */
  blocked: boolean;
  /** Số từ cấm tìm thấy. */
  hits: number;
  reason: string;
}

/** Che một từ nhưng giữ nguyên độ dài gần đúng để không lộ từ gốc. */
const mask = (word: string) => (word.length <= 2 ? '**' : '*'.repeat(Math.min(word.length, 6)));

export function moderate(input: string, opts: { blockRatio?: number } = {}): ModerateResult {
  const ratio = opts.blockRatio ?? 0.34;
  let hits = 0;
  let total = 0;

  const cleaned = input.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word) => {
    total += 1;
    const key = normalize(word);

    // 1. Tiếng Anh nằm trong từ (fucking, bullshit…)
    if (EN_RE.test(key)) {
      hits += 1;
      return mask(word);
    }
    // 2. Từ viết tắt 2–3 ký tự: chặn cả khi viết không dấu
    if (STRICT_SET.has(key)) {
      hits += 1;
      return mask(word);
    }
    // 3. Từ tiếng Việt đầy đủ: chỉ chặn khi đứng riêng một từ
    if (CONTEXTUAL_SET.has(key)) {
      hits += 1;
      return mask(word);
    }
    return word;
  });

  const blocked = total > 0 && hits / total >= ratio;
  return {
    text: blocked ? '*** Tin nhắn bị chặn vì chứa từ cấm ***' : cleaned,
    blocked,
    hits,
    reason: blocked ? 'Tin nhắn chứa quá nhiều từ cấm.' : hits > 0 ? 'Một số từ không phù hợp đã được che.' : '',
  };
}

export const isClean = (input: string) => moderate(input).hits === 0;