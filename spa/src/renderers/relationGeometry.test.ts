import { beforeEach, describe, expect, it } from 'vitest';
import type { Task, Viewport } from '../types';
import { RelationType } from '../types/constraints';
import type { Relation } from '../types';
import {
    buildRelationRenderContext,
    buildRelationRoutePoints,
    clearRelationIndexCache,
    distanceToPolyline,
    getPolylineMidpoint,
    normalizeRelationForRendering,
    selectRoutableRelations
} from './relationGeometry';

const DAY_MS = 24 * 60 * 60 * 1000;

const viewport: Viewport = {
    startDate: 0,
    scrollX: 0,
    scrollY: 0,
    scale: 1 / DAY_MS,
    width: 800,
    height: 600,
    rowHeight: 32
};

const buildTask = (id: string, startDate: number, dueDate: number, rowIndex: number): Task => ({
    id,
    subject: `Task ${id}`,
    projectId: 'p1',
    projectName: 'Project',
    displayOrder: rowIndex,
    startDate,
    dueDate,
    ratioDone: 0,
    statusId: 1,
    lockVersion: 0,
    editable: true,
    rowIndex,
    hasChildren: false
});

describe('getPolylineMidpoint', () => {
    it('returns the midpoint along the route length', () => {
        expect(getPolylineMidpoint([
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
        ])).toEqual({ x: 10, y: 0 });
    });
});

describe('distanceToPolyline', () => {
    it('returns a small distance for points close to the route', () => {
        const distance = distanceToPolyline({ x: 5, y: 3 }, [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 }
        ]);

        expect(distance).toBe(3);
    });
});

describe('normalizeRelationForRendering', () => {
    it('reverses follows relations into logical predecessor-to-successor order', () => {
        const tasks = [
            buildTask('1', 0, DAY_MS, 0),
            buildTask('2', DAY_MS * 4, DAY_MS * 5, 1)
        ];
        const context = buildRelationRenderContext(tasks, viewport, 2);

        expect(normalizeRelationForRendering({
            from: '1',
            to: '2',
            type: RelationType.Follows
        }, context)).toEqual({
            from: '2',
            to: '1',
            showArrow: true
        });
    });

    it('reverses blocked relations into logical blocker-to-blocked order', () => {
        const tasks = [
            buildTask('1', 0, DAY_MS, 0),
            buildTask('2', DAY_MS * 4, DAY_MS * 5, 1)
        ];
        const context = buildRelationRenderContext(tasks, viewport, 2);

        expect(normalizeRelationForRendering({
            from: '1',
            to: '2',
            type: RelationType.Blocked
        }, context)).toEqual({
            from: '2',
            to: '1',
            showArrow: true
        });
    });

    it('draws relates from the left task to the right task without an arrow', () => {
        const tasks = [
            buildTask('1', DAY_MS * 8, DAY_MS * 9, 0),
            buildTask('2', DAY_MS, DAY_MS * 2, 1)
        ];
        const context = buildRelationRenderContext(tasks, viewport, 2);

        expect(normalizeRelationForRendering({
            from: '1',
            to: '2',
            type: RelationType.Relates
        }, context)).toEqual({
            from: '2',
            to: '1',
            showArrow: false
        });
    });

    it('keeps raw order for relates when both tasks share the same center x', () => {
        const tasks = [
            buildTask('1', DAY_MS * 2, DAY_MS * 3, 0),
            buildTask('2', DAY_MS * 2, DAY_MS * 3, 1)
        ];
        const context = buildRelationRenderContext(tasks, viewport, 2);

        expect(normalizeRelationForRendering({
            from: '2',
            to: '1',
            type: RelationType.Relates
        }, context)).toEqual({
            from: '2',
            to: '1',
            showArrow: false
        });
    });
});

describe('buildRelationRoutePoints', () => {
    it('routes relates using normalized left-to-right endpoints', () => {
        const tasks = [
            buildTask('1', DAY_MS * 8, DAY_MS * 9, 0),
            buildTask('2', DAY_MS, DAY_MS * 2, 1)
        ];
        const context = buildRelationRenderContext(tasks, viewport, 2);
        const points = buildRelationRoutePoints({
            from: '1',
            to: '2',
            type: RelationType.Relates
        }, context, viewport);

        expect(points).toBeTruthy();
        if (!points) {
            throw new Error('Expected relation route points');
        }
        expect(points[0].x).toBeLessThan(points[points.length - 1].x);
    });
});

describe('selectRoutableRelations', () => {
    const relation = (id: string, from: string, to: string): Relation => ({
        id, from, to, type: RelationType.Precedes
    });

    beforeEach(() => {
        clearRelationIndexCache();
    });

    const contextFor = (ids: string[]) => buildRelationRenderContext(
        ids.map((id, index) => buildTask(id, 0, DAY_MS, index)),
        viewport,
        2
    );

    it('keeps only relations whose endpoints are both in the render context', () => {
        const relations = [
            relation('r1', 'a', 'b'),
            relation('r2', 'b', 'offscreen'),
            relation('r3', 'offscreen', 'elsewhere')
        ];

        const selected = selectRoutableRelations(relations, contextFor(['a', 'b']));

        expect(selected.map((entry) => entry.id)).toEqual(['r1']);
    });

    it('drops exactly the relations that could not be routed anyway', () => {
        const ids = Array.from({ length: 40 }, (_, index) => `t${index}`);
        const relations: Relation[] = [];
        for (let index = 0; index < 200; index += 1) {
            relations.push(relation(`r${index}`, `t${index % 40}`, `t${(index * 7) % 40}`));
        }
        // Relations reaching rows that are not in the window at all.
        relations.push(relation('far-1', 't0', 'way-off'));
        relations.push(relation('far-2', 'way-off', 'further-off'));

        const context = contextFor(ids.slice(0, 12));
        const selected = selectRoutableRelations(relations, context);
        const routableByBruteForce = relations.filter(
            (entry) => buildRelationRoutePoints(entry, context, viewport) !== null
        );

        expect(selected.map((entry) => entry.id)).toEqual(routableByBruteForce.map((entry) => entry.id));
    });

    it('preserves the source order so overlapping routes stack unchanged', () => {
        const ids = Array.from({ length: 30 }, (_, index) => `t${index}`);
        const relations = [
            relation('r-late', 't5', 't6'),
            relation('r-mid', 't1', 't2'),
            relation('r-early', 't0', 't3')
        ];
        // Pad so the index path is taken rather than the direct filter.
        for (let index = 0; index < 60; index += 1) {
            relations.push(relation(`pad-${index}`, `t${index % 30}`, `t${(index + 1) % 30}`));
        }

        const context = contextFor(ids);
        const selected = selectRoutableRelations(relations, context);

        const expected = relations.filter(
            (entry) => context.taskById.has(entry.from) && context.taskById.has(entry.to)
        );
        expect(selected).toEqual(expected);
    });

    it('handles an empty context and empty relations', () => {
        expect(selectRoutableRelations([], contextFor(['a']))).toEqual([]);
        expect(selectRoutableRelations([relation('r1', 'a', 'b')], contextFor([]))).toEqual([]);
    });

    it('rebuilds the index when the relations array is replaced', () => {
        const context = contextFor(['a', 'b', 'c']);
        const first = [relation('r1', 'a', 'b')];
        expect(selectRoutableRelations(first, context).map((entry) => entry.id)).toEqual(['r1']);

        const second = [relation('r2', 'b', 'c')];
        expect(selectRoutableRelations(second, context).map((entry) => entry.id)).toEqual(['r2']);
    });
});
