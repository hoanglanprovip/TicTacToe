import { describe, expect, it } from 'vitest';
import { isClean, moderate, normalize } from '../profanity.js';

describe('normalize', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(normalize('ĐÁn')).toBe('dan');
    expect(normalize('đéo')).toBe('deo');
  });

  it('đổi leetspeak', () => {
    expect(normalize('f0ck')).toBe('fock');
    expect(normalize('@ss')).toBe('ass');
  });

  it('gộp chữ lặp', () => {
    expect(normalize('fuuuuck')).toBe('fuck');
    expect(normalize('đmmmm')).toBe('dm');
  });

  it('bỏ ký tự đặc biệt', () => {
    expect(normalize('f*u*c*k')).toBe('fuck');
  });
});

describe('moderate', () => {
  it('cho phép tin nhắn sạch', () => {
    const r = moderate('chào bạn, đi đánh thôi');
    expect(r.blocked).toBe(false);
    expect(r.hits).toBe(0);
    expect(r.text).toBe('chào bạn, đi đánh thôi');
  });

  it('che từ cấm tiếng Anh', () => {
    const r = moderate('what the fuck');
    expect(r.hits).toBe(1);
    expect(r.blocked).toBe(false);
    expect(r.text).not.toContain('fuck');
    expect(r.text).toContain('what the');
  });

  it('chặn hẳn khi phần lớn là từ cấm', () => {
    const r = moderate('fuck you');
    expect(r.blocked).toBe(true);
    expect(r.text).toContain('bị chặn');
    expect(r.reason).not.toBe('');
  });

  it('chặn khi dùng từ viết tắt', () => {
    expect(moderate('vl').hits).toBe(1);
    expect(moderate('vcl').hits).toBe(1);
    expect(moderate('đéo').hits).toBe(1);
  });

  it('không báo nhầm từ thường chứa chuỗi giống', () => {
    expect(isClean('mình đói')).toBe(true);
    expect(isClean('ngựa chạy nhanh')).toBe(true);
    expect(isClean('cho em xin')).toBe(true);
    expect(isClean('con đường này đông lắm')).toBe(true);
    expect(isClean('bạn làm được không')).toBe(true);
    expect(isClean('ngày mai đi chơi nhé')).toBe(true);
  });

  it('giữ nguyên dấu tiếng Việt của phần không bị che', () => {
    const r = moderate('đừng vl đi');
    expect(r.text).toContain('đừng');
    expect(r.text).not.toContain('vl');
  });

  it('giới hạn độ dài che', () => {
    const r = moderate('a'.repeat(50));
    expect(r.hits).toBe(0);
  });
});