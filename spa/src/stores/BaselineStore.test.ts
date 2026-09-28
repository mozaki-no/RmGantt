import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBaselineStore } from './BaselineStore';
import { apiClient } from '../api/client';
import type { BaselineSnapshot } from '../types/baseline';

const snapshot = (id: string, scope: BaselineSnapshot['scope']): BaselineSnapshot => ({
    snapshotId: id,
    projectId: '1',
    capturedAt: '2026-09-21T14:59:59Z',
    scope,
    tasksByIssueId: {}
});

describe('BaselineStore history comparison', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        useBaselineStore.getState().reset();
    });

    it('shows the history snapshot while a date is chosen and restores the saved baseline on clear', async () => {
        const saved = snapshot('saved', 'project');
        const history = snapshot('history-2026-09-21', 'history');
        useBaselineStore.getState().setSnapshot(saved);
        vi.spyOn(apiClient, 'fetchHistoryBaseline').mockResolvedValue({ snapshot: history, warnings: [] });

        await expect(useBaselineStore.getState().loadHistory('2026-09-21')).resolves.toBe(true);
        expect(useBaselineStore.getState().snapshot).toBe(history);
        expect(useBaselineStore.getState().historyDate).toBe('2026-09-21');

        // A data reload keeps the history view but refreshes the saved baseline.
        const reloaded = snapshot('saved-2', 'project');
        useBaselineStore.getState().setSnapshot(reloaded);
        expect(useBaselineStore.getState().snapshot).toBe(history);

        useBaselineStore.getState().clearHistory();
        expect(useBaselineStore.getState().snapshot).toBe(reloaded);
        expect(useBaselineStore.getState().historyDate).toBeNull();
    });

    it('keeps the previous comparison when loading history fails', async () => {
        const saved = snapshot('saved', 'filtered');
        useBaselineStore.getState().setSnapshot(saved);
        vi.spyOn(apiClient, 'fetchHistoryBaseline').mockRejectedValue(new Error('boom'));

        await expect(useBaselineStore.getState().loadHistory('2026-09-21')).resolves.toBe(false);
        expect(useBaselineStore.getState().historyStatus).toBe('error');
        expect(useBaselineStore.getState().snapshot).toBe(saved);
    });

    it('ignores a history response that arrives after the comparison was cleared', async () => {
        let resolve: (value: { snapshot: BaselineSnapshot | null; warnings: string[] }) => void = () => {};
        vi.spyOn(apiClient, 'fetchHistoryBaseline').mockReturnValue(new Promise((r) => { resolve = r; }));

        const pending = useBaselineStore.getState().loadHistory('2026-09-21');
        useBaselineStore.getState().clearHistory();
        resolve({ snapshot: snapshot('late', 'history'), warnings: [] });

        await expect(pending).resolves.toBe(false);
        expect(useBaselineStore.getState().snapshot).toBeNull();
    });
});
