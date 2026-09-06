import { describe, expect, it } from 'vitest';
import { routeDependencyFS, segmentIntersectsRect } from './dependencyRouting';

describe('segmentIntersectsRect', () => {
    it('returns true when a segment crosses the rect', () => {
        const rect = { x: 10, y: 10, width: 20, height: 10 };
        const from = { x: 0, y: 15 };
        const to = { x: 40, y: 15 };

        expect(segmentIntersectsRect(from, to, rect)).toBe(true);
    });

    it('returns false when a segment is outside the rect', () => {
        const rect = { x: 10, y: 10, width: 20, height: 10 };
        const from = { x: 0, y: 0 };
        const to = { x: 40, y: 0 };

        expect(segmentIntersectsRect(from, to, rect)).toBe(false);
    });
});

describe('routeDependencyFS', () => {
    it('returns the basic orthogonal route when there are no obstacles', () => {
        const fromRect = { x: 0, y: 0, width: 20, height: 10 };
        const toRect = { x: 120, y: 0, width: 20, height: 10 };
        const viewport = { scrollY: 0, height: 200 };
        const context = {
            rowHeight: 40,
            fromRowIndex: 0,
            toRowIndex: 0,
            columnWidth: 40
        };
        const points = routeDependencyFS(fromRect, toRect, [], viewport, context, {
            outset: 20,
            inset: 10,
            step: 20,
            maxShift: 3
        });

        expect(points.length).toBeGreaterThanOrEqual(4);
        expect(points[0].x).toBe(fromRect.x + fromRect.width);
        expect(points[points.length - 1].x).toBe(toRect.x);
        // Note: The optimized direct Z-route (Strategy 1) may not pass through grid lines
        // when both source and target are on the same row with a clear gap between them.
        // In such cases, the route is a simple [fromPort -> dropX,fromY -> dropX,toY -> toPort]
        // which doesn't necessarily cross row boundaries.
    });

    it('shifts the mid route to avoid obstacles', () => {
        const fromRect = { x: 0, y: 0, width: 20, height: 10 };
        const toRect = { x: 120, y: 40, width: 20, height: 10 };
        const obstacle = { x: 40, y: 42, width: 60, height: 6 };
        const viewport = { scrollY: 0, height: 200 };

        const context = {
            rowHeight: 40,
            fromRowIndex: 0,
            toRowIndex: 1,
            columnWidth: 40
        };
        const points = routeDependencyFS(fromRect, toRect, [obstacle], viewport, context, {
            outset: 20,
            inset: 10,
            step: 20,
            maxShift: 2
        });

        expect(points.some((point, index) => {
            if (index === 0 || index === points.length - 1) return false;
            return point.y % context.rowHeight === 0;
        })).toBe(true);
        expect(points.some((point, index) => {
            if (index === points.length - 1) return false;
            return segmentIntersectsRect(point, points[index + 1], obstacle);
        })).toBe(false);
    });
});

describe('routeDependencyFS endpoint exclusion', () => {
    // Callers used to hand in a freshly filtered obstacle array per relation.
    // They now share one array and name the two endpoint rects instead, so the
    // two forms must produce byte-identical routes for any configuration.
    const viewport = { scrollY: 0, height: 600 };
    const params = { outset: 20, inset: 12, step: 32, maxShift: 8 };

    const buildScenario = (seed: number) => {
        const pseudoRandom = (offset: number) => {
            const value = Math.sin(seed * 97 + offset * 31) * 10_000;
            return value - Math.floor(value);
        };

        const fromRect = { x: 40, y: 32, width: 120, height: 14 };
        const toRect = { x: 520, y: 32 + 32 * (1 + Math.floor(pseudoRandom(1) * 6)), width: 90, height: 14 };
        const obstacles = [fromRect, toRect];

        const blockerCount = 1 + Math.floor(pseudoRandom(2) * 8);
        for (let index = 0; index < blockerCount; index += 1) {
            obstacles.push({
                x: 60 + pseudoRandom(index * 3 + 4) * 460,
                y: 32 * Math.floor(pseudoRandom(index * 3 + 5) * 8),
                width: 20 + pseudoRandom(index * 3 + 6) * 120,
                height: 14
            });
        }

        return { fromRect, toRect, obstacles };
    };

    it('matches a pre-filtered obstacle array across many configurations', () => {
        for (let seed = 1; seed <= 120; seed += 1) {
            const { fromRect, toRect, obstacles } = buildScenario(seed);
            const context = {
                rowHeight: 32,
                fromRowIndex: Math.round(fromRect.y / 32),
                toRowIndex: Math.round(toRect.y / 32),
                columnWidth: 24
            };

            const preFiltered = routeDependencyFS(
                fromRect,
                toRect,
                obstacles.filter((rect) => rect !== fromRect && rect !== toRect),
                viewport,
                context,
                params
            );
            const excludedByIdentity = routeDependencyFS(
                fromRect,
                toRect,
                obstacles,
                viewport,
                context,
                params,
                fromRect,
                toRect
            );

            expect(excludedByIdentity).toEqual(preFiltered);
        }
    });

    it('still avoids obstacles that are not the endpoints', () => {
        const fromRect = { x: 40, y: 0, width: 60, height: 14 };
        const toRect = { x: 400, y: 0, width: 60, height: 14 };
        const blocker = { x: 150, y: 0, width: 200, height: 14 };
        const context = { rowHeight: 32, fromRowIndex: 0, toRowIndex: 0, columnWidth: 24 };

        const withBlocker = routeDependencyFS(
            fromRect, toRect, [fromRect, toRect, blocker], viewport, context, params, fromRect, toRect
        );
        const withoutBlocker = routeDependencyFS(
            fromRect, toRect, [fromRect, toRect], viewport, context, params, fromRect, toRect
        );

        expect(withBlocker).not.toEqual(withoutBlocker);
    });
});
