'use client';

import { useState } from 'react';
import { newBrowserKey } from '@/lib/credits/browser-key';

/**
 * The one step of the alerts flow that happens on the page: a key, made in
 * this browser and shown once. Nothing is sent to make it. While the desk is
 * free a key only names a subscription, so this is all a reader needs before
 * registering a webhook.
 */
export function KeyMaker({ labels }: { labels: { make: string; again: string; key: string; hash: string; copy: string } }) {
  const [made, setMade] = useState<{ key: string; hash: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    setBusy(true);
    try {
      setMade(await newBrowserKey());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void make()}
        className="kicker border border-(--color-accent) px-4 py-2 text-(--color-paper) hover:bg-(--color-accent) hover:text-(--color-ink) disabled:text-(--color-paper-faint)"
      >
        {made ? labels.again : labels.make}
      </button>
      {made ? (
        <>
          <dl className="mt-4 space-y-3 text-[12px]">
            <div>
              <dt className="kicker">{labels.key}</dt>
              <dd className="tabular mt-1 break-all text-(--color-paper)">{made.key}</dd>
            </div>
            <div>
              <dt className="kicker">{labels.hash}</dt>
              <dd className="tabular mt-1 break-all text-(--color-paper-dim)">{made.hash}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[12px] text-(--color-paper-faint)">{labels.copy}</p>
        </>
      ) : null}
    </div>
  );
}
