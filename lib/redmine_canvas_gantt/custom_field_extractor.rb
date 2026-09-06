require 'set'

module RedmineCanvasGantt
  class CustomFieldExtractor
    def initialize(serializer:, supported_formats:)
      @serializer = serializer
      @supported_formats = supported_formats
      # Issue#available_custom_fields is a pure function of (project, tracker),
      # so both the applicable id set and the field objects themselves can be
      # memoized per pair instead of recomputed for every issue.
      @applicable_custom_field_ids = {}
    end

    def build_project_custom_fields(project_ids, issues = [])
      seen = {}

      project_fields = Project.where(id: project_ids).flat_map do |project|
        load_project_issue_custom_fields(project).select do |custom_field|
          custom_field.is_a?(IssueCustomField) &&
            @serializer.visible_for_project?(custom_field, project) &&
            !custom_field.multiple? &&
            @supported_formats.include?(custom_field.field_format.to_s)
        end
      end

      issue_fields = representative_issues_per_field_scope(issues).flat_map do |issue|
        issue.custom_field_values.map(&:custom_field)
      end.compact.select do |custom_field|
        custom_field.is_a?(IssueCustomField) &&
          !custom_field.multiple? &&
          @supported_formats.include?(custom_field.field_format.to_s)
      end

      (project_fields + issue_fields)
        .uniq { |custom_field| custom_field.id }
        .sort_by { |custom_field| [custom_field.position || 0, custom_field.name.to_s.downcase] }
        .each_with_object([]) do |custom_field, result|
          next if seen[custom_field.id]

          seen[custom_field.id] = true
          result << @serializer.serialize(custom_field)
        end
    end

    def extract_custom_fields(issue, editable)
      return [[], {}] unless editable

      applicable_custom_field_ids = issue_applicable_custom_field_ids(issue)
      custom_fields = []
      custom_field_values = {}

      issue.custom_field_values.each do |custom_field_value|
        custom_field = custom_field_value.custom_field
        next unless custom_field
        next unless applicable_custom_field_ids.include?(custom_field.id)
        next if custom_field.multiple?
        next unless @supported_formats.include?(custom_field.field_format.to_s)

        custom_fields << @serializer.serialize(custom_field)
        custom_field_values[custom_field.id.to_s] = custom_field_value.value
      end

      [custom_fields, custom_field_values]
    end

    def build_task_custom_field_values(issue)
      applicable_custom_field_ids = issue_applicable_custom_field_ids(issue)
      issue.custom_field_values.each_with_object({}) do |custom_field_value, values|
        custom_field = custom_field_value.custom_field
        next unless custom_field
        next unless applicable_custom_field_ids.include?(custom_field.id)
        next if custom_field.multiple?
        next unless @supported_formats.include?(custom_field.field_format.to_s)

        values[custom_field.id.to_s] = custom_field_value.value
      end
    end

    private

    # The custom field set of an issue is determined by its project and
    # tracker, so one representative per distinct pair yields the same union of
    # fields as walking the entire collection.
    def representative_issues_per_field_scope(issues)
      representatives = {}

      Array(issues).each do |issue|
        key = field_scope_key(issue)
        representatives[key] ||= issue
      end

      representatives.values
    end

    def field_scope_key(issue)
      project_id = issue.respond_to?(:project_id) ? issue.project_id : nil
      tracker_id = issue.respond_to?(:tracker_id) ? issue.tracker_id : nil
      [project_id, tracker_id]
    end

    def load_project_issue_custom_fields(project)
      Array(project.all_issue_custom_fields)
    rescue NoMethodError
      begin
        Array(project.issue_custom_fields)
      rescue NoMethodError
        []
      end
    end

    def issue_applicable_custom_field_ids(issue)
      key = field_scope_key(issue)
      return @applicable_custom_field_ids[key] if @applicable_custom_field_ids.key?(key)

      @applicable_custom_field_ids[key] = compute_applicable_custom_field_ids(issue)
    end

    def compute_applicable_custom_field_ids(issue)
      available_fields = if issue.respond_to?(:available_custom_fields)
                           Array(issue.available_custom_fields)
                         else
                           []
                         end

      ids = available_fields
        .select { |field| field.respond_to?(:id) }
        .map(&:id)
        .compact

      return ids.uniq.to_set unless ids.empty?

      Array(issue.custom_field_values)
        .filter_map { |value| value.custom_field&.id }
        .uniq
        .to_set
    rescue StandardError
      Set.new
    end
  end
end
