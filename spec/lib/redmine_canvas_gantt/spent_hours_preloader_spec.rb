require_relative '../../spec_helper'

RSpec.describe RedmineCanvasGantt::SpentHoursPreloader do
  let(:current_user) { User.anonymous }

  it 'does nothing for an empty collection' do
    expect(Issue).not_to receive(:load_visible_spent_hours)

    described_class.call([], current_user)
    described_class.call(nil, current_user)
  end

  it 'collapses the collection into Redmine\'s grouped preloader' do
    issues = [instance_double(Issue), instance_double(Issue)]

    expect(Issue).to receive(:load_visible_spent_hours).with(issues, current_user).once

    described_class.call(issues, current_user)
  end

  it 'falls back to the single argument signature' do
    issues = [instance_double(Issue)]
    call_count = 0

    allow(Issue).to receive(:load_visible_spent_hours) do |*args|
      call_count += 1
      raise ArgumentError, 'wrong number of arguments' if args.size == 2

      nil
    end

    described_class.call(issues, current_user)

    expect(call_count).to eq(2)
  end

  it 'never breaks the request when the preloader raises' do
    issues = [instance_double(Issue)]
    allow(Issue).to receive(:load_visible_spent_hours).and_raise(StandardError, 'boom')

    expect { described_class.call(issues, current_user) }.not_to raise_error
  end
end
