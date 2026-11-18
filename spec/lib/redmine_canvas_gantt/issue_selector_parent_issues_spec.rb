require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/issue_selector'

RSpec.describe RedmineCanvasGantt::IssueSelector, 'parent issues for an assignee filter' do
  let(:project) { Project.find(1) }
  let(:author) { User.find(2) }
  let(:assignee) { User.find(3) }
  let(:selector) do
    described_class.new(issue_scope: Issue.all, issue_includes: [:status], current_user: User.find(1))
  end

  def create_issue(subject, assigned_to: nil, parent: nil)
    Issue.create!(
      project: project,
      tracker: project.trackers.first,
      author: author,
      status: IssueStatus.first,
      priority: IssuePriority.first,
      subject: subject,
      assigned_to: assigned_to,
      parent_issue_id: parent&.id
    )
  end

  def selected_ids(include_parent_issues:)
    selector.call(
      query_issue_scope: nil,
      project_ids: [project.id],
      redmine_project_ids: nil,
      state: {
        selected_status_ids: [],
        selected_version_ids: [],
        selected_assignee_ids: [assignee.id],
        selected_tracker_ids: [],
        include_parent_issues: include_parent_issues,
        sort_config: nil
      }
    ).map(&:id)
  end

  let!(:grandparent) { create_issue('Canvas parent test epic', assigned_to: author) }
  let!(:parent) { create_issue('Canvas parent test feature', parent: grandparent) }
  let!(:child) { create_issue('Canvas parent test task', assigned_to: assignee, parent: parent) }
  let!(:sibling) { create_issue('Canvas parent test sibling', assigned_to: author, parent: parent) }

  it 'returns only the assignee issues by default' do
    ids = selected_ids(include_parent_issues: false)

    expect(ids).to include(child.id)
    expect(ids).not_to include(grandparent.id, parent.id, sibling.id)
  end

  it 'adds the whole parent chain regardless of assignee when requested' do
    ids = selected_ids(include_parent_issues: true)

    expect(ids).to include(child.id, parent.id, grandparent.id)
    expect(ids).not_to include(sibling.id)
    expect(ids - [parent.id, grandparent.id]).to all(satisfy { |id| Issue.find(id).assigned_to_id == assignee.id })
  end
end
