import { beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
    buildDependencySummary,
    clearDependencySummaryCache,
    filterRelationsForSelected,
    getDependencySummary,
    getOverflowBadgeLabel
} from './dependencyIndicators';

const buildTask = (id: string): Task => ({
    id,
    subject: id,
    startDate: 0,
    dueDate: 0,
    ratioDone: 0,
    statusId: 1,
    lockVersion: 0,
    editable: true,
    rowIndex: 0,
    hasChildren: false
});

describe('buildDependencySummary', () => {
    it('counts incoming and outgoing relations for visible tasks', () => {
        const tasks = [buildTask('a'), buildTask('b'), buildTask('c')];
        const relations = [
            { id: 'r1', from: 'a', to: 'b', type: 'precedes' },
            { id: 'r2', from: 'c', to: 'a', type: 'precedes' }
        ];

        const summary = buildDependencySummary(tasks, relations);

        expect(summary.get('a')).toEqual({ incoming: 1, outgoing: 1 });
        expect(summary.get('b')).toEqual({ incoming: 1, outgoing: 0 });
        expect(summary.get('c')).toEqual({ incoming: 0, outgoing: 1 });
    });
});

describe('filterRelationsForSelected', () => {
    it('limits relations for the selected task', () => {
        const relations = [
            { id: 'r1', from: 'a', to: 'b', type: 'precedes' },
            { id: 'r2', from: 'c', to: 'a', type: 'precedes' },
            { id: 'r3', from: 'a', to: 'd', type: 'precedes' }
        ];

        const result = filterRelationsForSelected(relations, 'a', 2);

        expect(result.relations).toHaveLength(2);
        expect(result.overflowCount).toBe(1);
    });
});

describe('getOverflowBadgeLabel', () => {
    it('returns empty string when overflow is zero', () => {
        expect(getOverflowBadgeLabel(0)).toBe('');
    });

    it('returns +N label when overflow is positive', () => {
        expect(getOverflowBadgeLabel(3)).toBe('+3');
    });
});

describe('getDependencySummary', () => {
    beforeEach(() => {
        clearDependencySummaryCache();
    });

    it('returns the same result as an uncached build', () => {
        const tasks = [buildTask('a'), buildTask('b'), buildTask('c')];
        const relations = [
            { id: 'r1', from: 'a', to: 'b', type: 'precedes' },
            { id: 'r2', from: 'c', to: 'a', type: 'precedes' }
        ];

        expect(getDependencySummary(tasks, relations))
            .toEqual(buildDependencySummary(tasks, relations));
    });

    it('reuses the summary while the task and relation arrays are unchanged', () => {
        const tasks = [buildTask('a'), buildTask('b')];
        const relations = [{ id: 'r1', from: 'a', to: 'b', type: 'precedes' }];

        const first = getDependencySummary(tasks, relations);

        expect(getDependencySummary(tasks, relations)).toBe(first);
    });

    it('recomputes when either array is replaced', () => {
        const tasks = [buildTask('a'), buildTask('b')];
        const relations = [{ id: 'r1', from: 'a', to: 'b', type: 'precedes' }];
        const first = getDependencySummary(tasks, relations);

        const nextRelations = [...relations, { id: 'r2', from: 'b', to: 'a', type: 'precedes' }];
        const second = getDependencySummary(tasks, nextRelations);

        expect(second).not.toBe(first);
        expect(second.get('a')).toEqual({ incoming: 1, outgoing: 1 });

        const third = getDependencySummary([...tasks], nextRelations);
        expect(third).not.toBe(second);
        expect(third).toEqual(second);
    });
});
