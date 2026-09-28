require_relative '../spec_helper'

RSpec.describe CanvasGanttsController, type: :controller do
  fixtures :projects, :users, :roles, :members, :member_roles, :enabled_modules,
           :trackers, :issue_statuses, :issues, :enumerations, :journals, :journal_details,
           :projects_trackers, :workflows

  let(:project) { Project.find(1) }
  let(:issue) { Issue.find(1) }
  let(:admin) { User.find(1) }

  before do
    project.enable_module!(:canvas_gantt)
    controller.send(:start_user_session, admin)
    User.current = admin
    Journal.where(journalized_type: 'Issue', journalized_id: issue.id).delete_all
    issue.update_columns(start_date: Date.new(2026, 9, 1), due_date: Date.new(2026, 9, 10),
                         done_ratio: 0, status_id: 1, created_on: Time.utc(2026, 8, 1))
  end

  def change_issue(at:, **attributes)
    fresh = Issue.find(issue.id)
    fresh.init_journal(admin)
    attributes.each { |key, value| fresh.send("#{key}=", value) }
    fresh.save!
    fresh.current_journal.update_column(:created_on, at)
  end

  def change_issue_of(target, at:, **attributes)
    fresh = Issue.find(target.id)
    fresh.init_journal(admin)
    attributes.each { |key, value| fresh.send("#{key}=", value) }
    fresh.save!
    fresh.current_journal.update_column(:created_on, at)
  end

  def fetch_history(date, time = nil)
    get :history_baseline, params: { project_id: project.id, date: date, time: time, format: :json }.compact
  end

  it 'rebuilds dates, progress and status as of the end of the given day from the journals' do
    change_issue(at: Time.utc(2026, 9, 5, 3), due_date: Date.new(2026, 9, 20), done_ratio: 30)
    change_issue(at: Time.utc(2026, 9, 12, 3), due_date: Date.new(2026, 9, 25), done_ratio: 70, status_id: 2)

    fetch_history('2026-09-08')

    expect(response).to have_http_status(:ok)
    baseline = JSON.parse(response.body).fetch('baseline')
    expect(baseline).to include('scope' => 'history', 'history_date' => '2026-09-08')
    expect(baseline['tasks_by_issue_id'][issue.id.to_s]).to include(
      'baseline_start_date' => '2026-09-01',
      'baseline_due_date' => '2026-09-20',
      'baseline_done_ratio' => 30,
      'baseline_status_id' => 1
    )
  end

  it 'rebuilds the state at the given time of day when a time is passed' do
    admin.pref.update!(time_zone: 'UTC')
    change_issue(at: Time.utc(2026, 9, 5, 3), due_date: Date.new(2026, 9, 20))
    change_issue(at: Time.utc(2026, 9, 5, 9), due_date: Date.new(2026, 9, 25))

    fetch_history('2026-09-05', '06:30')

    baseline = JSON.parse(response.body).fetch('baseline')
    expect(baseline).to include('history_date' => '2026-09-05', 'history_time' => '06:30')
    expect(baseline['tasks_by_issue_id'][issue.id.to_s]).to include('baseline_due_date' => '2026-09-20')

    fetch_history('2026-09-05', '02:59')
    expect(JSON.parse(response.body).dig('baseline', 'tasks_by_issue_id', issue.id.to_s, 'baseline_due_date')).to eq('2026-09-10')
  end

  it 'rejects an invalid time' do
    fetch_history('2026-09-05', '25:00')

    expect(response).to have_http_status(:unprocessable_entity)
  end

  it 'rebuilds a parent issue from its children, since Redmine does not journal derived parent values' do
    allow(Setting).to receive(:parent_issue_dates).and_return('derived')
    allow(Setting).to receive(:parent_issue_done_ratio).and_return('derived')
    child = Issue.create!(project: project, tracker: issue.tracker, author: admin, subject: 'child',
                          priority: issue.priority, status: IssueStatus.find(1), parent_issue_id: issue.id,
                          start_date: Date.new(2026, 9, 1), due_date: Date.new(2026, 9, 10))
    Issue.where(id: child.id).update_all(created_on: Time.utc(2026, 8, 2))
    Journal.where(journalized_type: 'Issue', journalized_id: issue.id).delete_all
    change_issue_of(child, at: Time.utc(2026, 9, 12, 3), due_date: Date.new(2026, 9, 25))
    expect(issue.reload.due_date).to eq(Date.new(2026, 9, 25))
    expect(Journal.where(journalized_type: 'Issue', journalized_id: issue.id)).to be_empty

    fetch_history('2026-09-08')

    expect(JSON.parse(response.body).dig('baseline', 'tasks_by_issue_id', issue.id.to_s)).to include(
      'baseline_due_date' => '2026-09-10'
    )
  end

  it 'leaves out issues created after the given day' do
    fetch_history('2026-07-01')

    expect(JSON.parse(response.body).dig('baseline', 'tasks_by_issue_id')).not_to have_key(issue.id.to_s)
  end

  it 'rejects an invalid date' do
    fetch_history('2026/09/08')

    expect(response).to have_http_status(:unprocessable_entity)
  end
end
