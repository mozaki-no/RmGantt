import { afterEach, describe, expect, it } from 'vitest';
import { getProjectFeatures, isColumnFeatureEnabled } from './projectFeatures';

describe('projectFeatures', () => {
    const original = window.RedmineCanvasGantt;

    afterEach(() => {
        window.RedmineCanvasGantt = original;
    });

    it('enables every feature when the page sends no flags', () => {
        expect(getProjectFeatures()).toEqual({ timeTracking: true, versions: true });
        expect(isColumnFeatureEnabled('spentHours')).toBe(true);
        expect(isColumnFeatureEnabled('version')).toBe(true);
    });

    it('drops the columns of disabled features only', () => {
        const features = { timeTracking: false, versions: false };
        expect(['timer', 'estimatedHours', 'spentHours', 'version'].some((key) => isColumnFeatureEnabled(key, features))).toBe(false);
        expect(isColumnFeatureEnabled('status', features)).toBe(true);
        expect(isColumnFeatureEnabled('cf:3', features)).toBe(true);
    });

    it('reads the flags from the page config', () => {
        window.RedmineCanvasGantt = { ...original!, features: { timeTracking: false } };
        expect(getProjectFeatures()).toEqual({ timeTracking: false, versions: true });
    });
});
