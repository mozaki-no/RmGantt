import type { Relation, Task } from '../types';
import {
    addWorkingDays,
    buildSchedulingEdges,
    detectConstraintCycleTaskIds,
    diffWorkingDays,
    shiftByWorkingDays,
    type SchedulingEdge
} from './constraintGraph';

export interface CriticalPathTaskMetrics {
    taskId: string;
    durationDays: number;
    es: number;
    ef: number;
    ls: number;
    lf: number;
    totalSlackDays: number;
    critical: boolean;
}

export interface CriticalPathResult {
    metricsByTaskId: Record<string, CriticalPathTaskMetrics>;
    projectFinish?: number;
    orderedTaskIds: string[];
    excludedTaskIds: string[];
    cyclicTaskIds: string[];
}

interface IncludedTask {
    id: string;
    projectId?: string;
    startDate: number;
    dueDate: number;
    inputOrder: number;
}

const hasFiniteDate = (value: number | undefined): value is number => Number.isFinite(value);

const hasValidDateRange = (task: Pick<Task, 'startDate' | 'dueDate'>): task is Pick<Task, 'startDate' | 'dueDate'> & { startDate: number; dueDate: number } => (
    hasFiniteDate(task.startDate) &&
    hasFiniteDate(task.dueDate) &&
    task.startDate <= task.dueDate
);

class MinHeap<T> {
    private readonly items: T[] = [];
    private readonly keyOf: (item: T) => number;

    constructor(keyOf: (item: T) => number) {
        this.keyOf = keyOf;
    }

    get size(): number {
        return this.items.length;
    }

    push(item: T): void {
        const items = this.items;
        items.push(item);
        let index = items.length - 1;
        const key = this.keyOf(item);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.keyOf(items[parent]) <= key) break;
            items[index] = items[parent];
            index = parent;
        }
        items[index] = item;
    }

    pop(): T | undefined {
        const items = this.items;
        if (items.length === 0) return undefined;
        const top = items[0];
        const last = items.pop() as T;
        if (items.length === 0) return top;

        const key = this.keyOf(last);
        let index = 0;
        for (;;) {
            const left = index * 2 + 1;
            if (left >= items.length) break;
            const right = left + 1;
            const child = right < items.length && this.keyOf(items[right]) < this.keyOf(items[left]) ? right : left;
            if (this.keyOf(items[child]) >= key) break;
            items[index] = items[child];
            index = child;
        }
        items[index] = last;
        return top;
    }
}

const buildTopologicalOrder = (taskIds: string[], edges: SchedulingEdge[], inputOrder: Map<string, number>): string[] => {
    const indegree = new Map<string, number>();
    const outgoing = new Map<string, SchedulingEdge[]>();

    taskIds.forEach((taskId) => {
        indegree.set(taskId, 0);
        outgoing.set(taskId, []);
    });

    edges.forEach((edge) => {
        indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
        const nextEdges = outgoing.get(edge.predecessorId) ?? [];
        nextEdges.push(edge);
        outgoing.set(edge.predecessorId, nextEdges);
    });

    // Kahn's algorithm that always takes the ready task with the lowest input
    // order. A binary heap keeps that O(n log n); re-sorting an array queue on
    // every push and shifting its head was quadratic and took over a second at
    // 10,000 tasks.
    const ready = new MinHeap<string>((taskId) => inputOrder.get(taskId) ?? 0);
    taskIds.forEach((taskId) => {
        if ((indegree.get(taskId) ?? 0) === 0) ready.push(taskId);
    });
    const orderedTaskIds: string[] = [];

    while (ready.size > 0) {
        const taskId = ready.pop();
        if (taskId === undefined) continue;

        orderedTaskIds.push(taskId);
        (outgoing.get(taskId) ?? []).forEach((edge) => {
            const nextIndegree = (indegree.get(edge.successorId) ?? 0) - 1;
            indegree.set(edge.successorId, nextIndegree);
            if (nextIndegree === 0) {
                ready.push(edge.successorId);
            }
        });
    }

    return orderedTaskIds;
};

export const calculateCriticalPath = (tasks: Task[], relations: Relation[]): CriticalPathResult => {
    const cyclicTaskIds = [...detectConstraintCycleTaskIds(relations)].sort();
    const cyclicTaskIdSet = new Set(cyclicTaskIds);
    const inputOrder = new Map<string, number>();
    const includedTasks = new Map<string, IncludedTask>();
    const excludedTaskIds: string[] = [];

    tasks.forEach((task, index) => {
        inputOrder.set(task.id, index);

        if (!hasValidDateRange(task) || cyclicTaskIdSet.has(task.id)) {
            excludedTaskIds.push(task.id);
            return;
        }

        includedTasks.set(task.id, {
            id: task.id,
            projectId: task.projectId,
            startDate: task.startDate,
            dueDate: task.dueDate,
            inputOrder: index
        });
    });

    const edges = buildSchedulingEdges(relations).filter((edge) => (
        includedTasks.has(edge.predecessorId) &&
        includedTasks.has(edge.successorId)
    ));
    const taskIds = [...includedTasks.keys()].sort((left, right) => (
        (inputOrder.get(left) ?? 0) - (inputOrder.get(right) ?? 0)
    ));
    const orderedTaskIds = buildTopologicalOrder(taskIds, edges, inputOrder);

    if (orderedTaskIds.length === 0) {
        return {
            metricsByTaskId: {},
            projectFinish: undefined,
            orderedTaskIds: [],
            excludedTaskIds,
            cyclicTaskIds
        };
    }

    const incoming = new Map<string, SchedulingEdge[]>();
    const outgoing = new Map<string, SchedulingEdge[]>();
    const metricsByTaskId = new Map<string, CriticalPathTaskMetrics>();

    orderedTaskIds.forEach((taskId) => {
        incoming.set(taskId, []);
        outgoing.set(taskId, []);
    });

    edges.forEach((edge) => {
        const predecessorEdges = outgoing.get(edge.predecessorId) ?? [];
        predecessorEdges.push(edge);
        outgoing.set(edge.predecessorId, predecessorEdges);

        const successorEdges = incoming.get(edge.successorId) ?? [];
        successorEdges.push(edge);
        incoming.set(edge.successorId, successorEdges);
    });

    orderedTaskIds.forEach((taskId) => {
        const task = includedTasks.get(taskId);
        if (!task) return;

        const durationDays = diffWorkingDays(task.startDate, task.dueDate, task.projectId);
        const minimumStart = (incoming.get(taskId) ?? []).reduce((latestStart, edge) => {
            const predecessor = metricsByTaskId.get(edge.predecessorId);
            if (!predecessor) return latestStart;
            return Math.max(latestStart, addWorkingDays(predecessor.ef, edge.gapDays, task.projectId));
        }, task.startDate);
        const es = minimumStart;
        const ef = shiftByWorkingDays(es, durationDays, task.projectId);

        metricsByTaskId.set(taskId, {
            taskId,
            durationDays,
            es,
            ef,
            ls: es,
            lf: ef,
            totalSlackDays: 0,
            critical: true
        });
    });

    const projectFinish = orderedTaskIds.reduce((latest, taskId) => {
        const metrics = metricsByTaskId.get(taskId);
        return metrics ? Math.max(latest, metrics.ef) : latest;
    }, Number.NEGATIVE_INFINITY);

    [...orderedTaskIds].reverse().forEach((taskId) => {
        const metrics = metricsByTaskId.get(taskId);
        if (!metrics) return;

        const successorEdges = outgoing.get(taskId) ?? [];
        const lf = successorEdges.length === 0
            ? projectFinish
            : successorEdges.reduce((earliestFinish, edge) => {
                const successor = metricsByTaskId.get(edge.successorId);
                const successorTask = includedTasks.get(edge.successorId);
                if (!successor) return earliestFinish;
                const latestFinish = shiftByWorkingDays(successor.ls, -edge.gapDays, successorTask?.projectId);
                return Math.min(earliestFinish, latestFinish);
            }, projectFinish);
        const task = includedTasks.get(taskId);
        const ls = shiftByWorkingDays(lf, -metrics.durationDays, task?.projectId);
        const totalSlackDays = diffWorkingDays(metrics.ef, lf, task?.projectId);

        metricsByTaskId.set(taskId, {
            ...metrics,
            ls,
            lf,
            totalSlackDays,
            critical: totalSlackDays === 0
        });
    });

    return {
        metricsByTaskId: Object.fromEntries(
            orderedTaskIds
                .map((taskId) => [taskId, metricsByTaskId.get(taskId)])
                .filter((entry): entry is [string, CriticalPathTaskMetrics] => Boolean(entry[1]))
        ),
        projectFinish,
        orderedTaskIds,
        excludedTaskIds,
        cyclicTaskIds
    };
};
