import type {
    BusinessCalendarDay,
    BusinessCalendarDefinition,
    BusinessCalendarPayload,
    BusinessDayInfo
} from '../types/businessCalendar';
import {
    addCalendarDays,
    calendarDateKey,
    calendarWeekday,
    parseDateOnly,
    timelineToCalendarDate
} from './dateOnly';
import { getNonWorkingWeekDays } from './nonWorkingWeekDays';
import { DatePlacementMode, type DatePlacementMode as DatePlacementModeValue } from '../types/constraints';

type UnknownRecord = Record<string, unknown>;
export type ProjectCalendarArgument = string | number | Set<number> | null | undefined;
export type WorkingDateDirection = 'forward' | 'backward';
export type TaskDateIntervalMode = 'move' | 'resize_start' | 'resize_due' | 'direct_edit' | 'project_move' | 'legacy_unspecified';

export type TaskDateInterval = {
    startDate?: number | null;
    dueDate?: number | null;
};

export type NormalizeTaskDateIntervalResult = {
    valid: true;
    interval: TaskDateInterval;
} | {
    valid: false;
    interval: TaskDateInterval;
    error: 'invalid_interval';
};

const EMPTY_PAYLOAD: BusinessCalendarPayload = {
    status: 'ok',
    revision: '',
    defaultCalendarId: null,
    projectCalendarIds: {},
    calendars: {},
    warnings: []
};

let configuredPayload: BusinessCalendarPayload = EMPTY_PAYLOAD;

const asRecord = (value: unknown): UnknownRecord | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null
);

const normalizeWeekDays = (value: unknown): number[] => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((day): day is number => (
        typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6
    )))].sort((left, right) => left - right);
};

const normalizeDay = (value: unknown): BusinessCalendarDay | null => {
    const record = asRecord(value);
    if (!record || typeof record.name !== 'string') return null;
    if (record.type !== 'working' && record.type !== 'non_working') return null;
    return { name: record.name, type: record.type };
};

const normalizeCalendar = (key: string, value: unknown): BusinessCalendarDefinition | null => {
    const record = asRecord(value);
    if (!record || typeof record.id !== 'string' || record.id !== key || typeof record.name !== 'string') return null;

    const rawDays = asRecord(record.days) ?? {};
    const days: Record<string, BusinessCalendarDay> = {};
    Object.entries(rawDays).forEach(([dateKey, rawDay]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
        const day = normalizeDay(rawDay);
        if (day) days[dateKey] = day;
    });

    return {
        id: record.id,
        name: record.name,
        nonWorkingWeekDays: normalizeWeekDays(record.non_working_week_days ?? record.nonWorkingWeekDays),
        days
    };
};

export const normalizeBusinessCalendarPayload = (value: unknown): BusinessCalendarPayload => {
    const record = asRecord(value);
    if (!record) return EMPTY_PAYLOAD;

    const rawCalendars = asRecord(record.calendars) ?? {};
    const calendars: Record<string, BusinessCalendarDefinition> = {};
    Object.entries(rawCalendars).forEach(([id, rawCalendar]) => {
        const calendar = normalizeCalendar(id, rawCalendar);
        if (calendar) calendars[id] = calendar;
    });

    const rawProjectCalendarIds = asRecord(record.project_calendar_ids ?? record.projectCalendarIds) ?? {};
    const projectCalendarIds: Record<string, string> = {};
    Object.entries(rawProjectCalendarIds).forEach(([projectId, calendarId]) => {
        if (typeof calendarId === 'string' && calendars[calendarId]) {
            projectCalendarIds[String(projectId)] = calendarId;
        }
    });

    const rawDefaultCalendarId = record.default_calendar_id ?? record.defaultCalendarId;
    const defaultCalendarId = typeof rawDefaultCalendarId === 'string' && calendars[rawDefaultCalendarId]
        ? rawDefaultCalendarId
        : null;
    const warnings = Array.isArray(record.warnings)
        ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
        : [];

    return {
        status: record.status === 'error' ? 'error' : 'ok',
        revision: typeof record.revision === 'string' ? record.revision : '',
        defaultCalendarId,
        projectCalendarIds,
        calendars,
        warnings,
        ...(typeof record.error === 'string' ? { error: record.error } : {})
    };
};

export const configureBusinessCalendar = (payload: unknown): BusinessCalendarPayload => {
    configuredPayload = normalizeBusinessCalendarPayload(payload);
    return configuredPayload;
};

export const getBusinessCalendarPayload = (): BusinessCalendarPayload => configuredPayload;

export const isBusinessCalendarReady = (): boolean => configuredPayload.status !== 'error';

export const getCalendarIdForProject = (projectId?: string | number | null): string | null => {
    if (projectId !== null && projectId !== undefined) {
        const assigned = configuredPayload.projectCalendarIds[String(projectId)];
        if (assigned) return assigned;
    }
    return configuredPayload.defaultCalendarId;
};

export const timestampToBusinessDateKey = (timestamp: number): string => calendarDateKey(timestamp);

const legacyDayInfo = (timestamp: number, weekDays?: Set<number>): BusinessDayInfo => {
    const nonWorkingWeekDays = weekDays ?? getNonWorkingWeekDays();
    return {
        name: null,
        type: nonWorkingWeekDays.has(calendarWeekday(timestamp)) ? 'non_working' : 'working',
        source: 'weekly'
    };
};

export const getDayInfo = (timestamp: number, projectId?: ProjectCalendarArgument): BusinessDayInfo => {
    if (projectId instanceof Set) return legacyDayInfo(timestamp, projectId);

    const calendarId = getCalendarIdForProject(projectId);
    const calendar = calendarId ? configuredPayload.calendars[calendarId] : undefined;
    if (!calendar) return legacyDayInfo(timestamp);

    const explicit = calendar.days[timestampToBusinessDateKey(timestamp)];
    if (explicit) {
        return { name: explicit.name, type: explicit.type, source: 'override' };
    }

    return {
        name: null,
        type: calendar.nonWorkingWeekDays.includes(calendarWeekday(timestamp)) ? 'non_working' : 'working',
        source: 'weekly'
    };
};

export const isWorkingDay = (timestamp: number, projectId?: ProjectCalendarArgument): boolean => (
    getDayInfo(timestamp, projectId).type === 'working'
);

/**
 * Returns the nearest working date in the requested direction.
 * Date-only values remain UTC-midnight calendar dates throughout the walk.
 */
export const normalizeWorkingDate = (
    timestamp: number,
    direction: WorkingDateDirection,
    projectId?: ProjectCalendarArgument
): number => {
    // Task dates are date-only UTC midnights. Preserve non-date numeric values
    // used by generic store callers rather than collapsing them to epoch day 0.
    if (!Number.isFinite(timestamp) || timestamp !== timelineToCalendarDate(timestamp)) {
        return timestamp;
    }
    let date = timelineToCalendarDate(timestamp);
    const step = direction === 'forward' ? 1 : -1;
    while (!isWorkingDay(date, projectId)) {
        date = addCalendarDays(date, step);
    }
    return date;
};

export const nextWorkingDay = (timestamp: number, projectId?: ProjectCalendarArgument): number => (
    normalizeWorkingDate(timestamp, 'forward', projectId)
);

export const previousWorkingDay = (timestamp: number, projectId?: ProjectCalendarArgument): number => (
    normalizeWorkingDate(timestamp, 'backward', projectId)
);

export const normalizeTaskDateInterval = (
    interval: TaskDateInterval,
    options: {
        changedFields: { startDate?: boolean; dueDate?: boolean };
        projectId?: ProjectCalendarArgument;
        mode?: TaskDateIntervalMode;
        datePlacementMode?: DatePlacementModeValue;
    }
): NormalizeTaskDateIntervalResult => {
    const startChanged = options.changedFields.startDate === true;
    const dueChanged = options.changedFields.dueDate === true;
    const datePlacementMode = options.datePlacementMode ?? DatePlacementMode.WorkingDays;
    const startDate = Number.isFinite(interval.startDate)
        ? datePlacementMode === DatePlacementMode.CalendarDays
            ? timelineToCalendarDate(interval.startDate!)
            : normalizeWorkingDate(interval.startDate!, 'forward', options.projectId)
        : interval.startDate;
    const dueDate = Number.isFinite(interval.dueDate)
        ? datePlacementMode === DatePlacementMode.CalendarDays
            ? timelineToCalendarDate(interval.dueDate!)
            : normalizeWorkingDate(interval.dueDate!, 'backward', options.projectId)
        : interval.dueDate;
    const normalized = { startDate, dueDate };

    if (Number.isFinite(startDate) && Number.isFinite(dueDate) && startDate! > dueDate!) {
        if (options.mode === 'resize_start' && !dueChanged) {
            return { valid: true, interval: { ...normalized, startDate: dueDate } };
        }
        if (options.mode === 'resize_due' && !startChanged) {
            return { valid: true, interval: { ...normalized, dueDate: startDate } };
        }
        return { valid: false, interval: normalized, error: 'invalid_interval' };
    }

    return { valid: true, interval: normalized };
};

export const addWorkingDays = (timestamp: number, days: number, projectId?: ProjectCalendarArgument): number => {
    let date = timelineToCalendarDate(timestamp);
    let remaining = Math.max(0, Math.floor(days));
    while (remaining > 0) {
        date = addCalendarDays(date, 1);
        if (isWorkingDay(date, projectId)) remaining -= 1;
    }
    return date;
};

export const shiftByWorkingDays = (timestamp: number, days: number, projectId?: ProjectCalendarArgument): number => {
    const normalizedDays = Math.trunc(days);
    if (normalizedDays === 0) return timelineToCalendarDate(timestamp);
    if (normalizedDays > 0) return addWorkingDays(timestamp, normalizedDays, projectId);

    let date = timelineToCalendarDate(timestamp);
    let remaining = Math.abs(normalizedDays);
    while (remaining > 0) {
        date = addCalendarDays(date, -1);
        if (isWorkingDay(date, projectId)) remaining -= 1;
    }
    return date;
};

const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

const weekdayOfDayIndex = (dayIndex: number): number => (((dayIndex + 4) % 7) + 7) % 7;

type OverrideAdjustments = {
    dayIndexes: number[];
    // prefix[i] is the sum of the working-day adjustments of dayIndexes[0..i).
    prefix: number[];
};

const overrideAdjustmentsCache = new WeakMap<BusinessCalendarDefinition, OverrideAdjustments>();

// Each override day adds or removes one working day relative to the calendar's
// weekly pattern. Sorted with prefix sums, a range count needs two binary
// searches instead of a lookup per day.
const overrideAdjustmentsFor = (calendar: BusinessCalendarDefinition): OverrideAdjustments => {
    const cached = overrideAdjustmentsCache.get(calendar);
    if (cached) return cached;

    const nonWorking = new Set(calendar.nonWorkingWeekDays);
    const entries: Array<[number, number]> = [];
    Object.entries(calendar.days).forEach(([dateKey, day]) => {
        const timestamp = parseDateOnly(dateKey);
        if (timestamp === null) return;
        const dayIndex = Math.round(timestamp / CALENDAR_DAY_MS);
        const weeklyWorking = nonWorking.has(weekdayOfDayIndex(dayIndex)) ? 0 : 1;
        const overrideWorking = day.type === 'working' ? 1 : 0;
        if (overrideWorking !== weeklyWorking) entries.push([dayIndex, overrideWorking - weeklyWorking]);
    });
    entries.sort((left, right) => left[0] - right[0]);

    const prefix = [0];
    entries.forEach(([, delta], index) => { prefix.push(prefix[index] + delta); });
    const adjustments = { dayIndexes: entries.map(([dayIndex]) => dayIndex), prefix };
    overrideAdjustmentsCache.set(calendar, adjustments);
    return adjustments;
};

const lowerBound = (values: number[], target: number): number => {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (values[middle] < target) low = middle + 1;
        else high = middle;
    }
    return low;
};

const countWeeklyWorkingDays = (firstDay: number, lastDay: number, nonWorking: Set<number>): number => {
    const days = lastDay - firstDay + 1;
    const fullWeeks = Math.floor(days / 7);
    let count = fullWeeks * (7 - nonWorking.size);
    for (let dayIndex = firstDay + fullWeeks * 7; dayIndex <= lastDay; dayIndex += 1) {
        if (!nonWorking.has(weekdayOfDayIndex(dayIndex))) count += 1;
    }
    return count;
};

// Counts the working days in the inclusive day-index range, matching
// isWorkingDay for every day without visiting each one.
const countWorkingDaysInRange = (firstDay: number, lastDay: number, projectId?: ProjectCalendarArgument): number => {
    if (lastDay < firstDay) return 0;
    if (projectId instanceof Set) return countWeeklyWorkingDays(firstDay, lastDay, projectId);

    const calendarId = getCalendarIdForProject(projectId);
    const calendar = calendarId ? configuredPayload.calendars[calendarId] : undefined;
    if (!calendar) return countWeeklyWorkingDays(firstDay, lastDay, getNonWorkingWeekDays());

    const weekly = countWeeklyWorkingDays(firstDay, lastDay, new Set(calendar.nonWorkingWeekDays));
    const { dayIndexes, prefix } = overrideAdjustmentsFor(calendar);
    return weekly + prefix[lowerBound(dayIndexes, lastDay + 1)] - prefix[lowerBound(dayIndexes, firstDay)];
};

const diffWorkingDaysByWalking = (from: number, to: number, projectId?: ProjectCalendarArgument): number => {
    const step = from < to ? 1 : -1;
    let current = from;
    let delta = 0;
    while (current !== to) {
        current = addCalendarDays(current, step);
        if (isWorkingDay(current, projectId)) delta += step;
    }
    return delta;
};

export const diffWorkingDays = (fromTimestamp: number, toTimestamp: number, projectId?: ProjectCalendarArgument): number => {
    const from = timelineToCalendarDate(fromTimestamp);
    const to = timelineToCalendarDate(toTimestamp);
    if (from === to) return 0;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return diffWorkingDaysByWalking(from, to, projectId);

    // Walking day by day made critical-path slack over a long project cost
    // O(tasks x days); the range count is O(log overrides) per call.
    const fromDay = Math.round(from / CALENDAR_DAY_MS);
    const toDay = Math.round(to / CALENDAR_DAY_MS);
    return fromDay < toDay
        ? countWorkingDaysInRange(fromDay + 1, toDay, projectId)
        : 0 - countWorkingDaysInRange(toDay, fromDay - 1, projectId);
};
