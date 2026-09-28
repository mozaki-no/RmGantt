module RedmineCanvasGantt
  # Rebuilds the state issues had at a past moment from Redmine's own issue
  # journals, so the SPA can compare "then" with "now" without a saved
  # baseline. Nothing is stored: every request walks the journals again.
  class JournalHistorySnapshotBuilder
    TRACKED_ATTRIBUTES = %w[start_date due_date done_ratio status_id].freeze
    ISSUE_ID_BATCH_SIZE = 1000

    def initialize(journal_detail_rows: nil)
      @journal_detail_rows = journal_detail_rows || method(:load_journal_detail_rows)
    end

    # issues: rows responding to id, start_date, due_date, done_ratio,
    # status_id and created_on (current values).
    # at: the moment to reconstruct (a Time).
    def build(project:, issues:, at:, date:)
      existing = Array(issues).reject { |issue| issue.created_on && issue.created_on > at }
      values_at = past_values_by_issue_id(existing.map(&:id), at)

      {
        snapshot_id: "history-#{date.iso8601}",
        project_id: project.id,
        captured_at: at.utc.iso8601,
        captured_by_id: nil,
        captured_by_name: nil,
        scope: 'history',
        history_date: date.iso8601,
        tasks_by_issue_id: existing.each_with_object({}) do |issue, result|
          result[issue.id.to_s] = task_payload(issue, values_at.fetch(issue.id, {}))
        end
      }
    end

    private

    # The first change recorded after `at` holds, in its old_value, the value
    # the attribute had at `at`. Attributes never changed since keep their
    # current value.
    def past_values_by_issue_id(issue_ids, at)
      result = Hash.new { |hash, key| hash[key] = {} }
      issue_ids.each_slice(ISSUE_ID_BATCH_SIZE) do |batch|
        @journal_detail_rows.call(batch, at).each do |issue_id, prop_key, old_value|
          values = result[issue_id.to_i]
          values[prop_key] = old_value unless values.key?(prop_key)
        end
      end
      result
    end

    def load_journal_detail_rows(issue_ids, at)
      JournalDetail
        .joins(:journal)
        .where(journals: { journalized_type: 'Issue', journalized_id: issue_ids })
        .where('journals.created_on > ?', at)
        .where(property: 'attr', prop_key: TRACKED_ATTRIBUTES)
        .order('journals.created_on ASC, journals.id ASC, journal_details.id ASC')
        .pluck('journals.journalized_id', 'journal_details.prop_key', 'journal_details.old_value')
    end

    def task_payload(issue, past_values)
      {
        issue_id: issue.id,
        baseline_start_date: date_value(past_values, 'start_date', issue.start_date),
        baseline_due_date: date_value(past_values, 'due_date', issue.due_date),
        baseline_done_ratio: integer_value(past_values, 'done_ratio', issue.done_ratio),
        baseline_status_id: integer_value(past_values, 'status_id', issue.status_id)
      }
    end

    def date_value(past_values, key, current)
      raw = past_values.key?(key) ? past_values[key] : current
      return nil if raw.blank?

      raw.is_a?(Date) ? raw.iso8601 : Date.iso8601(raw.to_s).iso8601
    rescue ArgumentError
      nil
    end

    def integer_value(past_values, key, current)
      raw = past_values.key?(key) ? past_values[key] : current
      return nil if raw.blank?

      Integer(raw.to_s, 10)
    rescue ArgumentError
      nil
    end
  end
end
