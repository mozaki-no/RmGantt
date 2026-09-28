module RedmineCanvasGantt
  # Rebuilds the state issues had at a past moment from Redmine's own issue
  # journals, so the SPA can compare "then" with "now" without a saved
  # baseline. Nothing is stored: every request walks the journals again.
  class JournalHistorySnapshotBuilder
    TRACKED_ATTRIBUTES = %w[start_date due_date done_ratio status_id estimated_hours].freeze
    ISSUE_ID_BATCH_SIZE = 1000

    # Redmine recalculates parent issues from their children without writing
    # a journal (Issue#recalculate_attributes_for), so those values are
    # derived again here from the children's past values, with the same rules.
    DerivationRules = Struct.new(
      :dates_derived, :done_ratio_derived, :use_status_for_done_ratio,
      :closed_status_ids, :default_done_ratio_by_status_id, keyword_init: true
    )

    def self.redmine_rules
      statuses = IssueStatus.all.to_a
      DerivationRules.new(
        dates_derived: Setting.parent_issue_dates == 'derived',
        done_ratio_derived: Setting.parent_issue_done_ratio == 'derived',
        use_status_for_done_ratio: Issue.use_status_for_done_ratio?,
        closed_status_ids: statuses.select(&:is_closed?).map(&:id),
        default_done_ratio_by_status_id: statuses.each_with_object({}) do |status, result|
          result[status.id] = status.default_done_ratio unless status.default_done_ratio.nil?
        end
      )
    end

    def initialize(journal_detail_rows: nil, rules: nil)
      @journal_detail_rows = journal_detail_rows || method(:load_journal_detail_rows)
      @rules = rules
    end

    # issues: rows responding to id, parent_id, start_date, due_date,
    # done_ratio, status_id, estimated_hours and created_on (current values).
    # at: the moment to reconstruct (a Time).
    def build(project:, issues:, at:, date:, time: nil)
      existing = Array(issues).reject { |issue| issue.created_on && issue.created_on > at }
      values_at = past_values_by_issue_id(existing.map(&:id), at)
      states = existing.each_with_object({}) do |issue, result|
        result[issue.id] = past_state(issue, values_at.fetch(issue.id, {}))
      end
      derive_parent_values(states)

      {
        snapshot_id: ["history", date.iso8601, time].compact.join('-'),
        project_id: project.id,
        captured_at: at.utc.iso8601,
        captured_by_id: nil,
        captured_by_name: nil,
        scope: 'history',
        history_date: date.iso8601,
        history_time: time,
        tasks_by_issue_id: states.each_with_object({}) do |(issue_id, state), result|
          result[issue_id.to_s] = task_payload(issue_id, state)
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

    def past_state(issue, past_values)
      {
        parent_id: issue.parent_id,
        start_date: date_value(past_values, 'start_date', issue.start_date),
        due_date: date_value(past_values, 'due_date', issue.due_date),
        done_ratio: integer_value(past_values, 'done_ratio', issue.done_ratio),
        status_id: integer_value(past_values, 'status_id', issue.status_id),
        estimated_hours: float_value(past_values, 'estimated_hours', issue.estimated_hours)
      }
    end

    # Deepest parents first, so a parent sees its child parents' derived
    # values. Only children that existed at that moment count; a parent with
    # none was a leaf then and keeps its journaled values.
    def derive_parent_values(states)
      children = states.each_with_object(Hash.new { |hash, key| hash[key] = [] }) do |(issue_id, state), result|
        result[state[:parent_id]] << issue_id if states.key?(state[:parent_id])
      end
      return if children.empty?

      depth = {}
      depth_of = lambda do |issue_id|
        depth[issue_id] ||= states.key?(states[issue_id][:parent_id]) ? depth_of.call(states[issue_id][:parent_id]) + 1 : 0
      end
      total_hours = {}
      children.keys.sort_by { |issue_id| -depth_of.call(issue_id) }.each do |parent_id|
        kids = children[parent_id].map { |issue_id| states[issue_id] }
        derive_dates(states[parent_id], kids)
        derive_done_ratio(states[parent_id], children[parent_id], states, children, total_hours)
      end
    end

    def derive_dates(parent, kids)
      return unless rules.dates_derived

      parent[:start_date] = kids.map { |kid| kid[:start_date] }.compact.min
      parent[:due_date] = kids.map { |kid| kid[:due_date] }.compact.max
      if parent[:start_date] && parent[:due_date] && parent[:due_date] < parent[:start_date]
        parent[:start_date], parent[:due_date] = parent[:due_date], parent[:start_date]
      end
    end

    def derive_done_ratio(parent, kid_ids, states, children, total_hours)
      return unless rules.done_ratio_derived
      return if rules.use_status_for_done_ratio && rules.default_done_ratio_by_status_id.key?(parent[:status_id])

      hours = kid_ids.map { |issue_id| Rational(total_estimated_hours(issue_id, states, children, total_hours).to_s) }
      estimated = hours.select(&:positive?)
      average = estimated.any? ? estimated.sum / estimated.size : Rational(1)
      done = kid_ids.each_with_index.sum do |issue_id, index|
        kid = states[issue_id]
        ratio = rules.closed_status_ids.include?(kid[:status_id]) ? 100 : (kid[:done_ratio] || 0)
        (hours[index].positive? ? hours[index] : average) * ratio
      end
      parent[:done_ratio] = (done / (average * kid_ids.size)).floor
    end

    def total_estimated_hours(issue_id, states, children, memo)
      memo[issue_id] ||= states[issue_id][:estimated_hours].to_f +
        children.fetch(issue_id, []).sum { |child_id| total_estimated_hours(child_id, states, children, memo) }
    end

    def rules
      @rules ||= self.class.redmine_rules
    end

    def task_payload(issue_id, state)
      {
        issue_id: issue_id,
        baseline_start_date: state[:start_date]&.iso8601,
        baseline_due_date: state[:due_date]&.iso8601,
        baseline_done_ratio: state[:done_ratio],
        baseline_status_id: state[:status_id]
      }
    end

    def date_value(past_values, key, current)
      raw = past_values.key?(key) ? past_values[key] : current
      return nil if raw.blank?

      raw.is_a?(Date) ? raw : Date.iso8601(raw.to_s)
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

    def float_value(past_values, key, current)
      raw = past_values.key?(key) ? past_values[key] : current
      return nil if raw.blank?

      Float(raw.to_s)
    rescue ArgumentError
      nil
    end
  end
end
