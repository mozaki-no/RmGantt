module RedmineCanvasGantt
  module SpentHoursBatch
    def self.for(issues, current_user:)
      ids = issues.map(&:id).uniq
      return {} if ids.empty?

      TimeEntry.visible(current_user).where(issue_id: ids).group(:issue_id).sum(:hours)
    end
  end
end
