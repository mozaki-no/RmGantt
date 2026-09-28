require 'set'
require_relative 'mutation_authorization_policy'
require_relative 'spent_hours_batch'
require_relative 'version_progress_preloader'

module RedmineCanvasGantt
  class DataPayloadBuilder
    def initialize(custom_field_extractor:, current_user:, data_payload_budget: nil,
                   version_progress_preloader: VersionProgressPreloader, authorization_policy: nil)
      @custom_field_extractor = custom_field_extractor
      @current_user = current_user
      @data_payload_budget = data_payload_budget
      @version_progress_preloader = version_progress_preloader
      @authorization_policy = authorization_policy || MutationAuthorizationPolicy.new(current_user: current_user)
    end

    def build(project:, permissions:, project_ids:, issues:, filter_option_projects:, filter_option_assignees:, filter_option_trackers: nil, initial_state: nil, query_context: nil, warnings: [], baseline: nil, business_calendar: nil, relations: nil, spent_hours_by_issue_id: nil)
      {
        tasks: build_tasks(issues, spent_hours_by_issue_id: spent_hours_by_issue_id),
        custom_fields: @custom_field_extractor.build_project_custom_fields(project_ids, issues),
        relations: relations ? build_relations_from(relations) : build_relations(issues),
        versions: build_versions(project_ids),
        filter_options: build_filter_options(
          projects: filter_option_projects,
          assignee_candidates: filter_option_assignees,
          trackers: filter_option_trackers || []
        ),
        statuses: build_statuses,
        project: build_project_payload(project),
        permissions: permissions,
        initial_state: initial_state,
        query_context: query_context,
        baseline: build_baseline_payload(baseline),
        businessCalendar: business_calendar,
        warnings: warnings.presence
      }.compact
    end

    # Serialization stays free of per-issue queries: spent time is summed for
    # the whole collection in one grouped query (or handed in by the
    # IssueSelector when it already summed it to sort by spent time).
    def build_tasks(issues, spent_hours_by_issue_id: nil)
      can_log_time_by_project_id = {}
      can_edit_issues_by_project_id = {}
      spent_hours_by_issue_id ||= SpentHoursBatch.for(issues, current_user: @current_user)

      issues.each_with_index.map do |issue, idx|
        # The :edit_issues permission only depends on the project, so it is
        # memoized; Issue#editable? stays per-issue because workflow rules can
        # differ.  This is MutationAuthorizationPolicy#can_edit_issue? split so
        # the project half is evaluated once per project.
        can_edit_project = can_edit_issues_by_project_id.fetch(issue.project_id) do
          can_edit_issues_by_project_id[issue.project_id] = @authorization_policy.can_edit_project?(issue.project)
        end

        # Adding the collection keys to the fresh entity hash keeps the key
        # order a merge would give without copying 30 keys per issue.
        task = build_task_state(issue, spent_hours: spent_hours_by_issue_id.fetch(issue.id, 0.0))
        task[:display_order] = idx
        task[:editable] = can_edit_project && issue.editable?
        task[:can_log_time] = can_log_time_by_project_id.fetch(issue.project_id) do
          can_log_time_by_project_id[issue.project_id] = @authorization_policy.can_log_time?(issue.project)
        end
        task
      end
    end

    def build_task_states(issues)
      hours = SpentHoursBatch.for(issues, current_user: @current_user)
      issues.map { |issue| build_task_state(issue, spent_hours: hours.fetch(issue.id, 0.0)) }
    end

    # Mutation responses must describe the persisted Issue only.  In
    # particular, display_order and other collection/layout values belong to
    # the current query and are not canonical entity state.
    def build_task_state(issue, spent_hours: nil)
      spent_hours = SpentHoursBatch.for([issue], current_user: @current_user).fetch(issue.id, 0.0) if spent_hours.nil?
      {
          id: issue.id,
          subject: issue.subject,
          project_id: issue.project_id,
          project_name: issue.project.name,
          start_date: issue.start_date,
          due_date: issue.due_date,
          ratio_done: issue.done_ratio,
          status_id: issue.status_id,
          status_name: issue.status.name,
          assigned_to_id: issue.assigned_to_id,
          assigned_to_name: principal_name(issue.assigned_to_id) { issue.assigned_to },
          parent_id: issue.parent_id,
          has_physical_children: issue.rgt > issue.lft + 1,
          lock_version: issue.lock_version,
          tracker_id: issue.tracker_id,
          tracker_name: issue.tracker&.name,
          fixed_version_id: issue.fixed_version_id,
          priority_id: issue.priority_id,
          priority_name: issue.priority&.name,
          priority_position: issue.priority&.position,
          author_id: issue.author_id,
          author_name: principal_name(issue.author_id) { issue.author },
          category_id: issue.category_id,
          category_name: issue.category&.name,
          estimated_hours: issue.estimated_hours,
          created_on: issue.created_on,
          updated_on: issue.updated_on,
          spent_hours: spent_hours,
          fixed_version_name: issue.fixed_version&.name,
          custom_field_values: @custom_field_extractor.build_task_custom_field_values(issue)
      }
    end

    # Principal#name formats the configured user display format on every call.
    # The same few users are assignee or author of thousands of issues, so the
    # formatted name is memoized per principal for this builder.
    def principal_name(principal_id)
      return yield&.name if principal_id.nil?

      @principal_names ||= {}
      @principal_names.fetch(principal_id) { @principal_names[principal_id] = yield&.name }
    end

    def build_relations(issues)
      visible_ids = issues.map(&:id).to_set
      visible_relations = issues.flat_map(&:relations).uniq.filter do |relation|
        visible_ids.include?(relation.issue_from_id) && visible_ids.include?(relation.issue_to_id)
      end
      build_relations_from(visible_relations)
    end

    def build_relations_from(relations)
      relations.map do |relation|
        serialize_relation(relation)
      end
    end

    # Version#completed_percent and Version#start_date are per-version queries,
    # and completed_percent hides one subtree SUM per non-leaf fixed issue.
    # The preloader answers both for every version at once; when it declines
    # (an unexpected Redmine internal), serialization falls back to Redmine's
    # own accessors so the payload stays correct.
    def build_versions(project_ids)
      versions = load_versions(project_ids)
      progress = @version_progress_preloader.call(versions, @current_user)

      versions.map do |version|
        version_progress = progress[version.id]
        {
          id: version.id,
          name: version.name,
          effective_date: version.effective_date,
          start_date: version_progress ? version_progress.start_date : version.try(:start_date),
          completed_percent: version_progress ? version_progress.completed_percent : version.completed_percent,
          project_id: version.project_id,
          status: version.status
        }
      end
    end

    def load_versions(project_ids)
      scope = Version.visible.where(project_id: project_ids)
      return scope.to_a unless @data_payload_budget

      @data_payload_budget.load_records(
        scope,
        resource: 'versions',
        limit: @data_payload_budget.collection_limit
      )
    end

    def build_filter_options(projects:, assignee_candidates:, trackers:)
      {
        projects: build_project_options(projects),
        assignees: build_assignee_options(assignee_candidates),
        trackers: build_tracker_options(trackers)
      }
    end

    def build_project_options(projects)
      projects
        .map { |entry| { id: entry.id, name: entry.name } }
        .sort_by { |entry| entry[:name].to_s.downcase }
    end

    # Assignee candidates are built from a distinct (assigned_to_id,
    # project_id) projection rather than from materialized Issue records, so
    # the cost is O(assignee-project pairs) instead of O(visible issues).
    # Issue-like objects remain accepted for callers that already hold them.
    def build_assignee_options(candidates)
      grouped = {}

      candidates.each do |candidate|
        assignee_id, project_id, assignee_name = assignee_candidate_values(candidate)
        grouped[assignee_id] ||= {
          id: assignee_id,
          name: assignee_id.nil? ? nil : assignee_name,
          project_ids: Set.new
        }
        grouped[assignee_id][:name] ||= assignee_name if assignee_id
        grouped[assignee_id][:project_ids] << project_id.to_s if project_id.present?
      end

      grouped.values.map do |entry|
        {
          id: entry[:id],
          name: entry[:name],
          project_ids: entry[:project_ids].to_a.sort
        }
      end.sort_by do |entry|
        [entry[:id].nil? ? 0 : 1, entry[:name].to_s.downcase]
      end
    end

    def assignee_candidate_values(candidate)
      if candidate.is_a?(Hash)
        [
          candidate[:id] || candidate['id'],
          candidate[:project_id] || candidate['project_id'],
          candidate[:name] || candidate['name']
        ]
      else
        return [nil, nil, nil] unless candidate.respond_to?(:assigned_to_id)

        [candidate.assigned_to_id, candidate.project_id, candidate.assigned_to&.name]
      end
    end

    def build_statuses
      IssueStatus.sorted.map { |status| { id: status.id, name: status.name, is_closed: status.is_closed? } }
    end

    # Tracker candidates are intentionally built from the unfiltered,
    # permission-scoped candidate issue relation.  A selected tracker must not
    # make the other tracker options disappear from the toolbar.
    def build_tracker_options(candidates)
      grouped = {}

      candidates.each do |candidate|
        tracker_id, project_id, tracker_name = tracker_candidate_values(candidate)
        next if tracker_id.blank?

        grouped[tracker_id] ||= {
          id: tracker_id,
          name: tracker_name.to_s,
          project_ids: Set.new
        }
        grouped[tracker_id][:name] = tracker_name if grouped[tracker_id][:name].blank? && tracker_name.present?
        grouped[tracker_id][:project_ids] << project_id.to_s if project_id.present?
      end

      grouped.values.map do |entry|
        {
          id: entry[:id],
          name: entry[:name],
          project_ids: entry[:project_ids].to_a.sort
        }
      end.sort_by { |entry| entry[:name].to_s.downcase }
    end

    def tracker_candidate_values(candidate)
      if candidate.is_a?(Hash)
        [candidate[:id] || candidate['id'], candidate[:project_id] || candidate['project_id'], candidate[:name] || candidate['name']]
      else
        return [nil, nil, nil] unless candidate.respond_to?(:tracker_id)

        tracker = candidate.respond_to?(:tracker) ? candidate.tracker : nil
        [candidate.tracker_id, candidate.project_id, tracker&.name]
      end
    end

    def build_project_payload(project)
      {
        id: project.id,
        name: project.name,
        start_date: project.start_date,
        due_date: project.due_date
      }
    end

    def serialize_relation(relation)
      {
        id: relation.id,
        from: relation.issue_from_id,
        to: relation.issue_to_id,
        type: relation.relation_type,
        delay: relation.delay
      }
    end

    def build_baseline_payload(baseline)
      return nil if baseline.nil?

      if baseline.respond_to?(:to_payload_hash)
        baseline.to_payload_hash
      elsif baseline.is_a?(Hash)
        baseline
      end
    end
  end
end
