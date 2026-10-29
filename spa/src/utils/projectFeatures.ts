export type ProjectFeatures = {
    timeTracking: boolean;
    versions: boolean;
};

const TIME_TRACKING_COLUMN_KEYS = new Set(['timer', 'estimatedHours', 'spentHours']);
const VERSION_COLUMN_KEYS = new Set(['version']);

// Features are switched per project on the Redmine project settings page.
// A missing flag means the feature is enabled.
export const getProjectFeatures = (): ProjectFeatures => {
    const features = window.RedmineCanvasGantt?.features;
    return {
        timeTracking: features?.timeTracking !== false,
        versions: features?.versions !== false
    };
};

export const isColumnFeatureEnabled = (key: string, features: ProjectFeatures = getProjectFeatures()): boolean => {
    if (TIME_TRACKING_COLUMN_KEYS.has(key)) return features.timeTracking;
    if (VERSION_COLUMN_KEYS.has(key)) return features.versions;
    return true;
};
