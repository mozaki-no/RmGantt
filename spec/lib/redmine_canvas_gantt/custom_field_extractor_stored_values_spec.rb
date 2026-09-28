require_relative '../../spec_helper'

# build_task_custom_field_values reads the stored custom values of a persisted,
# unchanged issue directly instead of going through Issue#custom_field_values.
# These examples compare that fast path with Redmine's own accessor on a freshly
# loaded record, and check that the fast path is the one actually taken.
RSpec.describe RedmineCanvasGantt::CustomFieldExtractor do
  fixtures :projects, :users, :roles, :members, :member_roles, :trackers,
           :projects_trackers, :issue_statuses, :enumerations, :issues,
           :custom_fields, :custom_fields_projects, :custom_fields_trackers,
           :custom_values, :enabled_modules

  let(:extractor) do
    described_class.new(
      serializer: RedmineCanvasGantt::CustomFieldSerializer.new(current_user: User.find(1)),
      supported_formats: CanvasGanttsController::CUSTOM_FIELD_FORMATS
    )
  end

  # Redmine's answer, computed on a record that has not been preloaded, so the
  # extractor falls back to Issue#custom_field_values for it.
  def redmine_values(issue_id)
    described_class.new(
      serializer: RedmineCanvasGantt::CustomFieldSerializer.new(current_user: User.find(1)),
      supported_formats: CanvasGanttsController::CUSTOM_FIELD_FORMATS
    ).build_task_custom_field_values(Issue.find(issue_id))
  end

  def preloaded_issues
    Issue.where(id: Issue.pluck(:id)).preload(:project, :tracker, custom_values: :custom_field).to_a
  end

  it 'matches Issue#custom_field_values for every fixture issue without calling it' do
    issues = preloaded_issues
    expect(issues).not_to be_empty
    issues.each { |issue| expect(issue).not_to receive(:custom_field_values) }

    issues.each do |issue|
      expect(extractor.build_task_custom_field_values(issue)).to eq(redmine_values(issue.id)), "issue ##{issue.id}"
    end
  end

  it 'returns nil, not the field default, for a persisted issue without a stored value' do
    field = IssueCustomField.create!(
      name: 'Canvas stored-value default', field_format: 'string', default_value: 'fallback',
      is_for_all: true, trackers: Tracker.all
    )
    issue = preloaded_issues.find { |candidate| candidate.id == 1 }

    values = extractor.build_task_custom_field_values(issue)

    expect(values).to include(field.id.to_s => nil)
    expect(values).to eq(redmine_values(1))
  end

  it 'uses Redmine values for an issue whose custom values were assigned in memory' do
    field = IssueCustomField.create!(name: 'Canvas in-memory value', field_format: 'string', is_for_all: true, trackers: Tracker.all)
    issue = preloaded_issues.find { |candidate| candidate.id == 1 }
    issue.custom_field_values = { field.id.to_s => 'edited' }

    expect(extractor.build_task_custom_field_values(issue)).to include(field.id.to_s => 'edited')
  end

  it 'uses Redmine values for a changed issue' do
    issue = preloaded_issues.find { |candidate| candidate.id == 1 }
    issue.subject = 'Changed in memory'
    expect(issue).to receive(:custom_field_values).and_call_original

    extractor.build_task_custom_field_values(issue)
  end
end
