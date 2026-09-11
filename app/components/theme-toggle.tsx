'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

/**
 * The half-moon. One click flips the whole site between the two themes; the
 * choice is remembered per browser. The root attribute is set before first
 * paint by the inline script in the layout, so there is no flash — this
 * component only reads what that script decided and lets the reader change it.
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

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      title={theme === 'dark' ? 'Light' : 'Dark'}
      className="flex h-full w-full items-center justify-center"
    >
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.25" />
        <path d="M20 2 A18 18 0 0 0 20 38 Z" fill="currentColor" />
      </svg>
    </button>
  );
}
