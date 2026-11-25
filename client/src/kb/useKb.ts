import { useCallback, useEffect, useState } from 'react';
import type { KbItem } from '../../../shared/kb.ts';
import { idbStore } from './db.ts';

const store = idbStore<KbItem>('kb');

/** The knowledge base, kept in this browser's IndexedDB only. */
export function useKb() {
  const [items, setItems] = useState<KbItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    store.all().then(
      (all) => setItems(all.sort((a, b) => b.updatedAt - a.updatedAt)),
      () => setError("This browser can't store the knowledge base (IndexedDB unavailable)."),
    );
  }, []);
  useEffect(reload, [reload]);

  // Shown at once; reloaded from storage if the write fails.
  const save = useCallback(
    (item: KbItem) => {
      setItems((all) => [item, ...all.filter((i) => i.id !== item.id)]);
      void store.put(item).catch(() => (setError('Could not save the item.'), reload()));
    },
    [reload],
  );
  const remove = useCallback(
    (id: string) => {
      setItems((all) => all.filter((i) => i.id !== id));
      void store.delete(id).catch(() => (setError('Could not delete the item.'), reload()));
    },
    [reload],
  );

  return { items, error, save, remove, reload };
}
