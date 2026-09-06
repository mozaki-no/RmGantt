require_relative '../../spec_helper'

RSpec.describe RedmineCanvasGantt::CustomFieldExtractor do
  let(:serializer) { instance_double(RedmineCanvasGantt::CustomFieldSerializer) }
  let(:extractor) do
    described_class.new(serializer: serializer, supported_formats: %w[string list])
  end

  def build_custom_field(id:, name: "CF#{id}", format: 'string', position: id)
    instance_double(
      IssueCustomField,
      id: id, name: name, field_format: format, position: position, multiple?: false
    )
  end

  # `available_calls` counts how often the (project, tracker) field set is
  # resolved; `value_reads` counts how many distinct issues were inspected.
  def build_issue(project_id:, tracker_id:, fields:, available_calls:, value_reads: [])
    values = fields.map do |field|
      instance_double(CustomFieldValue, custom_field: field, value: "v#{field.id}")
    end

    issue = instance_double(Issue, project_id: project_id, tracker_id: tracker_id)
    allow(issue).to receive(:custom_field_values) do
      value_reads << issue.object_id
      values
    end
    allow(issue).to receive(:available_custom_fields) do
      available_calls[[project_id, tracker_id]] = available_calls.fetch([project_id, tracker_id], 0) + 1
      fields
    end
    issue
  end

  describe 'applicable custom field resolution' do
    it 'resolves the applicable field set once per (project, tracker) pair' do
      field = build_custom_field(id: 5)
      available_calls = {}
      issues = Array.new(50) do
        build_issue(project_id: 1, tracker_id: 2, fields: [field], available_calls: available_calls)
      end

      issues.each { |issue| extractor.build_task_custom_field_values(issue) }

      expect(available_calls).to eq({ [1, 2] => 1 })
    end

    it 'keeps distinct pairs isolated from each other' do
      field_a = build_custom_field(id: 5)
      field_b = build_custom_field(id: 6)
      available_calls = {}
      issue_a = build_issue(project_id: 1, tracker_id: 2, fields: [field_a], available_calls: available_calls)
      issue_b = build_issue(project_id: 1, tracker_id: 3, fields: [field_b], available_calls: available_calls)

      expect(extractor.build_task_custom_field_values(issue_a)).to eq({ '5' => 'v5' })
      expect(extractor.build_task_custom_field_values(issue_b)).to eq({ '6' => 'v6' })
      expect(available_calls).to eq({ [1, 2] => 1, [1, 3] => 1 })
    end
  end

  describe '#build_project_custom_fields' do
    it 'walks one representative issue per (project, tracker) pair' do
      field = build_custom_field(id: 5)
      available_calls = {}
      value_reads = []
      issues = Array.new(20) do
        build_issue(
          project_id: 1, tracker_id: 2, fields: [field],
          available_calls: available_calls, value_reads: value_reads
        )
      end

      allow(Project).to receive(:where).with(id: [1]).and_return([])
      allow(serializer).to receive(:serialize).with(field).and_return({ id: 5, name: 'CF5' })

      result = extractor.build_project_custom_fields([1], issues)

      expect(result).to eq([{ id: 5, name: 'CF5' }])
      expect(value_reads.uniq.size).to eq(1)
    end

    it 'unions the fields contributed by different tracker scopes' do
      field_a = build_custom_field(id: 5, name: 'Alpha', position: 1)
      field_b = build_custom_field(id: 6, name: 'Beta', position: 2)
      available_calls = {}
      issues = [
        build_issue(project_id: 1, tracker_id: 2, fields: [field_a], available_calls: available_calls),
        build_issue(project_id: 1, tracker_id: 3, fields: [field_b], available_calls: available_calls),
        build_issue(project_id: 1, tracker_id: 2, fields: [field_a], available_calls: available_calls)
      ]

      allow(Project).to receive(:where).with(id: [1]).and_return([])
      allow(serializer).to receive(:serialize).with(field_a).and_return({ id: 5 })
      allow(serializer).to receive(:serialize).with(field_b).and_return({ id: 6 })

      expect(extractor.build_project_custom_fields([1], issues)).to eq([{ id: 5 }, { id: 6 }])
    end
  end
end
