export type BaselineSaveScope = 'filtered' | 'project';
// 'history' snapshots are rebuilt from issue journals on request and never saved.
export type BaselineScope = BaselineSaveScope | 'history';

export interface BaselineTaskState {
    issueId: string;
    baselineStartDate: number | null;
    baselineDueDate: number | null;
    baselineDoneRatio?: number | null;
    baselineStatusId?: number | null;
}

export interface BaselineSnapshot {
    snapshotId: string;
    projectId: string;
    capturedAt: string;
    capturedById?: number | null;
    capturedByName?: string | null;
    scope: BaselineScope;
    historyDate?: string | null;
    tasksByIssueId: Record<string, BaselineTaskState>;
}
