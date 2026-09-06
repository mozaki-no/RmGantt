module RedmineCanvasGantt
  # Issue#spent_hours is a lazy per-record SUM over time_entries, so
  # serializing or sorting a collection of issues costs one query per issue.
  # Redmine ships a grouped preloader for exactly this case; this wrapper keeps
  # it optional so the plugin still works (just slower) on installations where
  # the helper is absent or raises.
  module SpentHoursPreloader
    module_function

    def call(issues, current_user)
      return if issues.nil? || issues.empty?
      return unless defined?(Issue) && Issue.respond_to?(:load_visible_spent_hours)

      begin
        Issue.load_visible_spent_hours(issues, current_user)
      rescue ArgumentError
        Issue.load_visible_spent_hours(issues)
      end
    rescue StandardError => e
      warn_skipped(e)
    end

    def warn_skipped(error)
      return unless defined?(Rails) && Rails.respond_to?(:logger) && Rails.logger

      Rails.logger.warn("[Canvas Gantt] spent_hours preload skipped: #{error.class}: #{error.message}")
    end
  end
end
