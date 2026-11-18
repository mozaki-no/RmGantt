// Display preference read by data fetches: when on, the server also returns
// the parent chain of assignee-filtered issues so they show as context rows.
let includeParentIssues = false;

export const setIncludeParentIssues = (enabled: boolean): void => {
    includeParentIssues = enabled;
};

export const shouldIncludeParentIssues = (): boolean => includeParentIssues;
