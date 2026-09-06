import { describe, it, expect } from 'vitest';
import { LayoutEngine } from './LayoutEngine';
import type { Viewport, Task, LayoutRow } from '../types';
import { parseDateOnly, toTimelineDate } from '../utils/dateOnly';

describe('LayoutEngine', () => {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const mockViewport: Viewport = {
        startDate: parseDateOnly('2024-01-01')!,
        scrollX: 0,
        scrollY: 0,
        scale: 1, // 1 px per ms
        width: 800,
        height: 600,
        rowHeight: 40
    };

    it('rejects raw instants at the CalendarDate and TimelineDate canvas boundaries', () => {
        void (() => {
            // @ts-expect-error Instants must first become a local CalendarDate.
            LayoutEngine.calendarDateToX(Date.now(), mockViewport);
            // @ts-expect-error CalendarDate values must be projected before timeline arithmetic.
            LayoutEngine.dateToX(parseDateOnly('2024-01-02')!, mockViewport);
        });

        expect(true).toBe(true);
    });

    it('dateToX converts date to x coordinate accurately', () => {
        const date = parseDateOnly('2024-01-02')!; // +1 day
        // 1 day = 86400000 ms
        const expectedX = 86400000;
        expect(LayoutEngine.dateToX(toTimelineDate(date), mockViewport)).toBe(expectedX);
    });

    it('getTaskBounds returns correct geometry', () => {
        const task: Task = {
            id: '1',
            subject: 'Test',
            startDate: parseDateOnly('2024-01-01')!,
            dueDate: parseDateOnly('2024-01-02')!,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 2);
        // height = Math.max(2, Math.round(40 * 0.45)) = 18
        // yOffset = Math.round((40 - 18) / 2) = 11
        expect(bounds.height).toBe(18);
        expect(bounds.y).toBe(11);
    });

    it('getTaskBounds centers single-date tasks in the day cell', () => {
        const task: Task = {
            id: '1',
            subject: 'Single Date',
            startDate: parseDateOnly('2024-01-01')!,
            dueDate: undefined,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 2);
        const expectedCenter = LayoutEngine.dateToX(
            LayoutEngine.calendarDateToTimeline(LayoutEngine.snapDate(task.startDate!), 'center'),
            mockViewport
        );

        expect(bounds.x + bounds.width / 2).toBe(expectedCenter);
    });

    it('projects local calendar dates onto UTC timeline cell boundaries', () => {
        const task: Task = {
            id: '1',
            subject: 'Snap',
            startDate: parseDateOnly('2024-01-01')!,
            dueDate: parseDateOnly('2024-01-02')!,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 2);
        const expectedStart = LayoutEngine.dateToX(
            LayoutEngine.calendarDateToTimeline(LayoutEngine.snapDate(task.startDate!)),
            mockViewport
        );
        const expectedEnd = LayoutEngine.dateToX(
            LayoutEngine.calendarDateToTimeline(LayoutEngine.snapDate(task.dueDate!), 'end'),
            mockViewport
        );

        expect(bounds.x).toBe(expectedStart);
        expect(bounds.x + bounds.width).toBe(expectedEnd);
    });

    it('uses exactly one UTC grid cell for a same-day task', () => {
        const calendarDate = parseDateOnly('2026-07-29')!;
        const viewport: Viewport = {
            ...mockViewport,
            startDate: Date.UTC(2026, 6, 29),
            scale: 40 / ONE_DAY
        };
        const task: Task = {
            id: 'same-day',
            subject: 'Same day',
            startDate: calendarDate,
            dueDate: calendarDate,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, viewport, 'bar', 2);

        expect(bounds.x).toBe(0);
        expect(bounds.width).toBe(40);
    });

    it.each([
        ['2026-03-08'],
        ['2026-11-01']
    ])('keeps cell boundaries fixed across DST transition date %s', (date) => {
        const calendarDate = parseDateOnly(date)!;
        const viewport: Viewport = {
            ...mockViewport,
            startDate: calendarDate,
            scale: 40 / ONE_DAY
        };
        const task: Task = {
            id: 'dst',
            subject: 'DST boundary',
            startDate: calendarDate,
            dueDate: calendarDate,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, viewport, 'bar', 2);

        expect(bounds.x).toBe(0);
        expect(bounds.width).toBe(40);
    });

    it('getTaskBounds(kind=hit) uses full row height for interactions', () => {
        const task: Task = {
            id: '1',
            subject: 'Test',
            startDate: parseDateOnly('2024-01-01')!,
            dueDate: parseDateOnly('2024-01-02')!,
            rowIndex: 2,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const bounds = LayoutEngine.getTaskBounds(task, mockViewport, 'hit', 2);
        expect(bounds.y).toBe(80);
        expect(bounds.height).toBe(40);
    });

    it('keeps task geometry day-accurate in week and month views', () => {
        const task: Task = {
            id: '1',
            subject: 'Cross Zoom',
            startDate: parseDateOnly('2024-01-03')!,
            dueDate: parseDateOnly('2024-01-05')!,
            rowIndex: 0,
            ratioDone: 0,
            statusId: 1,
            lockVersion: 0,
            editable: true,
            hasChildren: false
        };

        const expectedStart = LayoutEngine.calendarDateToTimeline(LayoutEngine.snapDate(task.startDate!));
        const expectedDueInclusive = LayoutEngine.calendarDateToTimeline(LayoutEngine.snapDate(task.dueDate!), 'end');
        const expectedX = LayoutEngine.dateToX(expectedStart, mockViewport);
        const expectedWidth = expectedDueInclusive - expectedStart;

        const dayBounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 2);
        const weekBounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 1);
        const monthBounds = LayoutEngine.getTaskBounds(task, mockViewport, 'bar', 0);

        expect(dayBounds.x).toBe(expectedX);
        expect(dayBounds.width).toBe(expectedWidth);
        expect(weekBounds.x).toBe(expectedX);
        expect(weekBounds.width).toBe(expectedWidth);
        expect(monthBounds.x).toBe(expectedX);
        expect(monthBounds.width).toBe(expectedWidth);
    });

    it('sliceTasksInRowRange は rowIndex 範囲のタスクだけ返す', () => {
        const tasks: Task[] = [
            { id: 'a', subject: 'a', startDate: 0, dueDate: 1, ratioDone: 0, statusId: 1, lockVersion: 0, editable: true, rowIndex: 0, hasChildren: false },
            { id: 'b', subject: 'b', startDate: 0, dueDate: 1, ratioDone: 0, statusId: 1, lockVersion: 0, editable: true, rowIndex: 2, hasChildren: false },
            { id: 'c', subject: 'c', startDate: 0, dueDate: 1, ratioDone: 0, statusId: 1, lockVersion: 0, editable: true, rowIndex: 5, hasChildren: false }
        ];

        expect(LayoutEngine.sliceTasksInRowRange(tasks, 0, 0).map(t => t.id)).toEqual(['a']);
        expect(LayoutEngine.sliceTasksInRowRange(tasks, 1, 4).map(t => t.id)).toEqual(['b']);
        expect(LayoutEngine.sliceTasksInRowRange(tasks, 2, 5).map(t => t.id)).toEqual(['b', 'c']);
        expect(LayoutEngine.sliceTasksInRowRange(tasks, 6, 10)).toEqual([]);
        expect(LayoutEngine.sliceTasksInRowRange(tasks, 4, 3)).toEqual([]);
    });
});

describe('LayoutEngine.sliceLayoutRowsInRowRange', () => {
    const rows: LayoutRow[] = [
        { type: 'header', projectId: 'p1', projectName: 'P1', groupKind: 'project', rowIndex: 0 },
        { type: 'task', taskId: 't1', rowIndex: 1 },
        { type: 'task', taskId: 't2', rowIndex: 2 },
        { type: 'header', projectId: 'p2', projectName: 'P2', groupKind: 'project', rowIndex: 3 },
        { type: 'task', taskId: 't3', rowIndex: 4 }
    ];

    const bruteForce = (startRow: number, endRow: number) => (
        rows.filter((row) => row.rowIndex >= startRow && row.rowIndex <= endRow)
    );

    it('matches a full scan for every window', () => {
        for (let start = -2; start <= 7; start += 1) {
            for (let end = -2; end <= 7; end += 1) {
                expect(LayoutEngine.sliceLayoutRowsInRowRange(rows, start, end))
                    .toEqual(bruteForce(start, end));
            }
        }
    });

    it('returns an empty slice for an inverted or empty range', () => {
        expect(LayoutEngine.sliceLayoutRowsInRowRange(rows, 3, 1)).toEqual([]);
        expect(LayoutEngine.sliceLayoutRowsInRowRange([], 0, 10)).toEqual([]);
    });

    it('reads only a slice of a large layout', () => {
        const many: LayoutRow[] = Array.from({ length: 20_000 }, (_, index) => ({
            type: 'task', taskId: `t${index}`, rowIndex: index
        }));

        const slice = LayoutEngine.sliceLayoutRowsInRowRange(many, 12_000, 12_029);

        expect(slice).toHaveLength(30);
        expect(slice[0].rowIndex).toBe(12_000);
        expect(slice[29].rowIndex).toBe(12_029);
    });
});
