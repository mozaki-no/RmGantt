import { create } from 'zustand';
import { apiClient } from '../api/client';
import type { BaselineSnapshot } from '../types/baseline';

type BaselineSaveStatus = 'idle' | 'saving' | 'ready' | 'error';
type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

interface BaselineState {
    // The snapshot the chart compares against: the history snapshot while a
    // history date is chosen, otherwise the saved baseline.
    snapshot: BaselineSnapshot | null;
    savedSnapshot: BaselineSnapshot | null;
    historySnapshot: BaselineSnapshot | null;
    historyDate: string | null;
    historyStatus: HistoryStatus;
    hasBaseline: boolean;
    saveStatus: BaselineSaveStatus;
    warnings: string[];
    lastError: string | null;
    setSnapshot: (snapshot: BaselineSnapshot | null, warnings?: string[]) => void;
    loadHistory: (date: string) => Promise<boolean>;
    clearHistory: () => void;
    setSaveStatus: (status: BaselineSaveStatus) => void;
    setWarnings: (warnings: string[]) => void;
    setLastError: (message: string | null) => void;
    reset: () => void;
}

let historyRequestSeq = 0;

export const useBaselineStore = create<BaselineState>((set, get) => ({
    snapshot: null,
    savedSnapshot: null,
    historySnapshot: null,
    historyDate: null,
    historyStatus: 'idle',
    hasBaseline: false,
    saveStatus: 'idle',
    warnings: [],
    lastError: null,
    setSnapshot: (snapshot, warnings = []) => set((state) => {
        const displayed = state.historySnapshot ?? snapshot;
        return {
            savedSnapshot: snapshot,
            snapshot: displayed,
            hasBaseline: Boolean(displayed),
            warnings,
            lastError: null,
            saveStatus: snapshot ? 'ready' : 'idle'
        };
    }),
    loadHistory: async (date) => {
        const requestSeq = ++historyRequestSeq;
        set(() => ({ historyDate: date, historyStatus: 'loading' }));
        try {
            const { snapshot } = await apiClient.fetchHistoryBaseline(date);
            if (requestSeq !== historyRequestSeq) return false;
            if (!snapshot) throw new Error('Invalid history baseline');
            set(() => ({
                historySnapshot: snapshot,
                snapshot,
                hasBaseline: true,
                historyStatus: 'ready'
            }));
            return true;
        } catch {
            if (requestSeq !== historyRequestSeq) return false;
            set(() => ({ historyStatus: 'error' }));
            return false;
        }
    },
    clearHistory: () => {
        historyRequestSeq += 1;
        const saved = get().savedSnapshot;
        set(() => ({
            historySnapshot: null,
            historyDate: null,
            historyStatus: 'idle',
            snapshot: saved,
            hasBaseline: Boolean(saved)
        }));
    },
    setSaveStatus: (status) => set(() => ({ saveStatus: status })),
    setWarnings: (warnings) => set(() => ({ warnings })),
    setLastError: (message) => set(() => ({ lastError: message, saveStatus: message ? 'error' : 'idle' })),
    reset: () => {
        historyRequestSeq += 1;
        set(() => ({
            snapshot: null,
            savedSnapshot: null,
            historySnapshot: null,
            historyDate: null,
            historyStatus: 'idle',
            hasBaseline: false,
            saveStatus: 'idle',
            warnings: [],
            lastError: null
        }));
    }
}));
