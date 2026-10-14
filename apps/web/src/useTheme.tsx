import { useCallback, useEffect, useState } from 'react';
import type { ThemeName } from './types';

export const THEMES: Array<{ id: ThemeName; label: string; swatch: string }> = [
  { id: 'dark', label: 'Manga Noir', swatch: '#12151d' },
  { id: 'light', label: 'Pop Art', swatch: '#ffd000' },
  { id: 'midnight', label: 'Cyber Mecha', swatch: '#00f0ff' },
  { id: 'forest', label: 'Slime Arcade', swatch: '#22c55e' },
];

const KEY = 'tt_theme';
const readInitial = (): ThemeName => {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(KEY) as ThemeName | null;
  return THEMES.some((t) => t.id === saved) ? saved! : 'dark';
};

/** Theme lưu ở localStorage, gắn vào <html data-theme> để CSS tự đổi biến. */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(readInitial);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: bỏ qua */
    }
  }, [theme]);

  const cycle = useCallback(() => {
    setTheme((current) => {
      const index = THEMES.findIndex((t) => t.id === current);
      return THEMES[(index + 1) % THEMES.length]!.id;
    });
  }, []);

  return { theme, setTheme, cycle };
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-picker" role="group" aria-label="Chọn giao diện truyện tranh">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={theme === t.id ? 'swatch is-active' : 'swatch'}
          style={{ background: t.swatch }}
          title={t.label}
          aria-label={t.label}
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
        />
      ))}
    </div>
  );
}
