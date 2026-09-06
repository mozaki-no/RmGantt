import { LayoutEngine } from '../engines/LayoutEngine';
import type { DraftRelation, Relation, Task, Viewport, ZoomLevel } from '../types';
import { RelationType } from '../types/constraints';
import { routeDependencyFS, type Point, type Rect, type RouteParams } from './dependencyRouting';

export const RELATION_HIT_TOLERANCE_PX = 10;
export const RELATION_ROUTE_PARAMS: RouteParams = {
    outset: 20,
    inset: 12,
    step: 24,
    maxShift: 8
};

export type RelationRenderContext = {
    taskById: Map<string, Task>;
    rectById: Map<string, Rect>;
    allRects: Array<{ id: string; rect: Rect }>;
    /** Same rects as `allRects`, flattened once so routing need not rebuild it per relation. */
    obstacleRects: Rect[];
};

type RelationRenderInput = Pick<Relation, 'from' | 'to' | 'type'> | Pick<DraftRelation, 'from' | 'to' | 'type'>;

export type NormalizedRelationForRendering = {
    from: string;
    to: string;
    showArrow: boolean;
};

export const shouldRenderRelationsAtZoom = (zoomLevel: ZoomLevel): boolean => zoomLevel >= 1;

export const buildRelationRenderContext = (
    tasks: Task[],
    viewport: Viewport,
    zoomLevel: ZoomLevel
): RelationRenderContext => {
    const taskById = new Map<string, Task>();
    const rectById = new Map<string, Rect>();
    const allRects: Array<{ id: string; rect: Rect }> = [];
    const obstacleRects: Rect[] = [];

    tasks.forEach((task) => {
        taskById.set(task.id, task);
        const bounds = LayoutEngine.getTaskBounds(task, viewport, 'bar', zoomLevel);
        const rect = {
            x: bounds.x + viewport.scrollX,
            y: bounds.y + viewport.scrollY,
            width: bounds.width,
            height: bounds.height
        };
        rectById.set(task.id, rect);
        allRects.push({ id: task.id, rect });
        obstacleRects.push(rect);
    });

    return { taskById, rectById, allRects, obstacleRects };
};

type RelationIndexCache = {
    relations: Relation[];
    byTaskId: Map<string, number[]>;
};

let relationIndexCache: RelationIndexCache | null = null;

/**
 * Maps a task id to the positions of the relations that touch it, memoized on
 * the identity of the relations array. TaskStore replaces that array whenever
 * relations actually change, so panning and scrolling reuse the index.
 */
const getRelationIndex = (relations: Relation[]): Map<string, number[]> => {
    const cached = relationIndexCache;
    if (cached && cached.relations === relations) return cached.byTaskId;

    const byTaskId = new Map<string, number[]>();
    const push = (taskId: string, position: number) => {
        const bucket = byTaskId.get(taskId);
        if (bucket) {
            bucket.push(position);
        } else {
            byTaskId.set(taskId, [position]);
        }
    };

    relations.forEach((relation, position) => {
        push(relation.from, position);
        if (relation.to !== relation.from) push(relation.to, position);
    });

    relationIndexCache = { relations, byTaskId };
    return byTaskId;
};

export const clearRelationIndexCache = (): void => {
    relationIndexCache = null;
};

/**
 * The relations that can actually produce a route in `context`.
 *
 * `buildRelationRoutePoints` returns null unless both endpoints resolve inside
 * the context, and rendering only ever reorders a relation's own two
 * endpoints, so filtering on them up front is a pre-filter rather than a
 * change in what gets drawn. It replaces a full scan of every relation on
 * every frame with a lookup proportional to the rows in view.
 *
 * The result keeps the order of the source array so overlapping routes stack
 * exactly as they did before.
 */
export const selectRoutableRelations = (
    relations: Relation[],
    context: RelationRenderContext
): Relation[] => {
    if (relations.length === 0 || context.taskById.size === 0) return [];

    // Walking the relations directly wins when there are few of them; the
    // index only pays off once relations outnumber the rows in view.
    if (relations.length <= context.taskById.size) {
        return relations.filter((relation) => (
            context.taskById.has(relation.from) && context.taskById.has(relation.to)
        ));
    }

    const index = getRelationIndex(relations);
    const positions = new Set<number>();

    context.taskById.forEach((_task, taskId) => {
        const bucket = index.get(taskId);
        if (!bucket) return;
        for (const position of bucket) {
            const relation = relations[position];
            if (!context.taskById.has(relation.from) || !context.taskById.has(relation.to)) continue;
            positions.add(position);
        }
    });

    return Array.from(positions)
        .sort((left, right) => left - right)
        .map((position) => relations[position]);
};

export const buildRelationRoutePoints = (
    relation: RelationRenderInput,
    context: RelationRenderContext,
    viewport: Viewport
): Point[] | null => {
    const normalizedRelation = normalizeRelationForRendering(relation, context);
    const fromTask = context.taskById.get(normalizedRelation.from);
    const toTask = context.taskById.get(normalizedRelation.to);
    if (!fromTask || !toTask) return null;

    if (!Number.isFinite(fromTask.startDate) || !Number.isFinite(fromTask.dueDate) ||
        !Number.isFinite(toTask.startDate) || !Number.isFinite(toTask.dueDate)) {
        return null;
    }

    const fromRect = context.rectById.get(normalizedRelation.from);
    const toRect = context.rectById.get(normalizedRelation.to);
    if (!fromRect || !toRect) return null;

    // The endpoints are excluded by identity rather than by rebuilding the
    // obstacle list, which previously allocated a copy of every visible rect
    // for every relation on every frame.
    const oneDayMs = 24 * 60 * 60 * 1000;
    return routeDependencyFS(
        fromRect,
        toRect,
        context.obstacleRects,
        { scrollY: viewport.scrollY, height: viewport.height },
        {
            rowHeight: viewport.rowHeight,
            fromRowIndex: fromTask.rowIndex,
            toRowIndex: toTask.rowIndex,
            columnWidth: oneDayMs * viewport.scale
        },
        {
            ...RELATION_ROUTE_PARAMS,
            step: viewport.rowHeight
        },
        fromRect,
        toRect
    );
};

export const normalizeRelationForRendering = (
    relation: RelationRenderInput,
    context: RelationRenderContext
): NormalizedRelationForRendering => {
    switch (relation.type) {
        case RelationType.Follows:
        case RelationType.Blocked:
            return {
                from: relation.to,
                to: relation.from,
                showArrow: true
            };
        case RelationType.Relates:
            return {
                ...normalizeRelatesEndpoints(relation, context),
                showArrow: false
            };
        default:
            return {
                from: relation.from,
                to: relation.to,
                showArrow: true
            };
    }
};

export const getPolylineMidpoint = (points: Point[]): Point => {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];

    let totalLength = 0;
    const segmentLengths: number[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
        const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
        segmentLengths.push(length);
        totalLength += length;
    }

    const halfway = totalLength / 2;
    let traversed = 0;
    for (let i = 0; i < segmentLengths.length; i += 1) {
        const length = segmentLengths[i];
        if (traversed + length < halfway) {
            traversed += length;
            continue;
        }

        const start = points[i];
        const end = points[i + 1];
        const ratio = length === 0 ? 0 : (halfway - traversed) / length;
        return {
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio
        };
    }

    return points[points.length - 1];
};

export const distanceToPolyline = (point: Point, points: Point[]): number => {
    if (points.length < 2) return Infinity;

    let minDistance = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
        minDistance = Math.min(minDistance, distanceToSegment(point, points[i], points[i + 1]));
    }
    return minDistance;
};

export const isRouteVisible = (points: Point[], viewport: Viewport): boolean => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    points.forEach((point) => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    });

    const viewLeft = viewport.scrollX;
    const viewRight = viewport.scrollX + viewport.width;
    const viewTop = viewport.scrollY;
    const viewBottom = viewport.scrollY + viewport.height;

    return !(maxX < viewLeft || minX > viewRight || maxY < viewTop || minY > viewBottom);
};

const distanceToSegment = (point: Point, start: Point, end: Point): number => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, projection));
    const projectedX = start.x + dx * clamped;
    const projectedY = start.y + dy * clamped;
    return Math.hypot(point.x - projectedX, point.y - projectedY);
};

const normalizeRelatesEndpoints = (
    relation: Pick<RelationRenderInput, 'from' | 'to'>,
    context: RelationRenderContext
): Pick<NormalizedRelationForRendering, 'from' | 'to'> => {
    const fromRect = context.rectById.get(relation.from);
    const toRect = context.rectById.get(relation.to);
    if (!fromRect || !toRect) {
        return { from: relation.from, to: relation.to };
    }

    const fromCenterX = fromRect.x + fromRect.width / 2;
    const toCenterX = toRect.x + toRect.width / 2;
    if (fromCenterX === toCenterX) {
        return { from: relation.from, to: relation.to };
    }

    if (fromCenterX < toCenterX) {
        return { from: relation.from, to: relation.to };
    }

    return { from: relation.to, to: relation.from };
};
