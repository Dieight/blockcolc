import type { Page } from '@playwright/test';
import { execute, type DomainCommand, type DomainState } from '@tomato-clock/domain';

type CurrentRecord = { revision?: number; state?: DomainState };

/** Read the browser's authoritative aggregate/revision pair for a test. */
export async function readPersistedDomainState(page: Page): Promise<{ state: DomainState; revision: number }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ state: DomainState; revision: number }>((resolve, reject) => {
        const request = database.transaction('appState', 'readonly').objectStore('appState').get('current');
        request.onsuccess = () => {
          const record = request.result as CurrentRecord | undefined;
          if (!record?.state) {
            reject(new Error('Persisted domain state is missing'));
            return;
          }
          resolve({ state: record.state, revision: record.revision ?? 0 });
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

/**
 * Apply a real domain command, then publish it as a newer IndexedDB revision
 * and reload the app. This models another legitimate writer/restore event
 * without bypassing domain validation or mutating production code.
 */
export async function executeAndReloadPersistedCommand(
  page: Page,
  state: DomainState,
  command: DomainCommand,
  nowMs: number,
): Promise<{ state: DomainState; revision: number }> {
  const result = execute(state, command, { now: () => new Date(nowMs) });
  if (!result.ok) throw new Error(`Test domain command failed: ${result.message}`);
  const revision = await page.evaluate(async (nextState) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction('appState', 'readwrite');
        const store = transaction.objectStore('appState');
        const current = store.get('current');
        current.onsuccess = () => {
          const record = current.result as CurrentRecord | undefined;
          const nextRevision = (record?.revision ?? 0) + 1;
          store.put({ id: 'current', revision: nextRevision, state: nextState });
          transaction.oncomplete = () => resolve(nextRevision);
        };
        current.onerror = () => reject(current.error);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, result.state);
  await page.reload();
  await page.locator('html').waitFor({ state: 'attached' });
  return { state: result.state, revision };
}
