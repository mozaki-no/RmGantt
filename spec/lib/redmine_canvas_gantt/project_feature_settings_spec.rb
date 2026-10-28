require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/project_feature_settings'

RSpec.describe RedmineCanvasGantt::ProjectFeatureSettings do
  let(:settings_reader) do
    Class.new do
      attr_accessor :plugin_redmine_canvas_gantt

      def initialize(value)
        @plugin_redmine_canvas_gantt = value
      end
    end.new({ 'row_height' => '36' })
  end

  subject(:feature_settings) { described_class.new(settings_reader: settings_reader) }

  it 'enables every feature for a project without stored settings' do
    expect(feature_settings.load(project_id: 1)).to eq('time_tracking' => true, 'versions' => true)
  end

  it 'stores disabled features per project and keeps other settings' do
    feature_settings.save(project_id: 1, features: { 'time_tracking' => '0', 'versions' => '1' })

    expect(feature_settings.load(project_id: 1)).to eq('time_tracking' => false, 'versions' => true)
    expect(feature_settings.load(project_id: 2)).to eq('time_tracking' => true, 'versions' => true)
    expect(settings_reader.plugin_redmine_canvas_gantt['row_height']).to eq('36')
  end

  it 'drops the stored entry when every feature is enabled again' do
    feature_settings.save(project_id: 1, features: { 'time_tracking' => '0', 'versions' => '0' })
    feature_settings.save(project_id: 1, features: { 'time_tracking' => '1', 'versions' => '1' })

    expect(settings_reader.plugin_redmine_canvas_gantt['project_features']).to eq({})
  end
end
