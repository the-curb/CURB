'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * INK · PAPER. One click flips the whole site between the two; the choice is
 * remembered per browser. The root attribute is set before first paint by
 * the inline script in the layout, so there is no flash — this component
 * only reads what that script decided and lets the reader change it.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('curb-theme', next);
    } catch {
      // A browser that refuses storage still gets the flip for this page.
    }
    setTheme(next);
  };

  const on = 'text-(--color-paper)';
  const off = 'text-(--color-paper-faint)';

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to paper' : 'Switch to ink'}
      title={theme === 'dark' ? 'Paper' : 'Ink'}
      className="tabular flex h-full items-center gap-2 text-[10px] uppercase tracking-[0.2em]"
    >
      <span className={theme === 'dark' ? on : off}>Ink</span>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-current" style={{ background: theme === 'dark' ? 'transparent' : 'currentColor' }} />
      <span className={theme === 'light' ? on : off}>Paper</span>
    </button>
  );
}
