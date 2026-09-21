'use client';

import { useEffect } from 'react';

/**
 * A folded document is still linked to by section: /mechanism#6-flows-and-screens
 * has to land on §6 open, not on a closed heading. This opens the <details>
 * a fragment names — or the one it sits inside — on load and whenever the
 * fragment changes, then scrolls to it. Without script the sections are
 * still there, one click away.
 */
export function HashOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id === '') return;
      const target = document.getElementById(id);
      if (target === null) return;
      for (let el: HTMLElement | null = target; el !== null; el = el.parentElement) {
        if (el instanceof HTMLDetailsElement) el.open = true;
      }
      target.scrollIntoView({ block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
