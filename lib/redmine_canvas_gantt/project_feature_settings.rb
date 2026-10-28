# frozen_string_literal: true

module RedmineCanvasGantt
  # Per-project switches for optional Canvas Gantt features. Values live in the
  # plugin's Setting row under STORAGE_KEY, keyed by project id. A project
  # without a stored entry keeps every feature enabled.
  class ProjectFeatureSettings
    STORAGE_KEY = 'project_features'.freeze
    SETTING_NAME = 'plugin_redmine_canvas_gantt'.freeze
    FEATURES = %w[time_tracking versions].freeze
    SETTINGS_MUTEX = Mutex.new

    def initialize(settings_reader: Setting)
      @settings_reader = settings_reader
    end

    def load(project_id:)
      stored = stored_features[project_id.to_s]
      stored = {} unless stored.is_a?(Hash)
      FEATURES.index_with { |feature| enabled_value?(stored.fetch(feature, true)) }
    end

    def save(project_id:, features:)
      values = FEATURES.index_with { |feature| enabled_value?(features[feature] || features[feature.to_sym]) }
      update_settings do |settings|
        all_features = settings[STORAGE_KEY].is_a?(Hash) ? settings[STORAGE_KEY].dup : {}
        if values.values.all?
          all_features.delete(project_id.to_s)
        else
          all_features[project_id.to_s] = values
        end
        settings.merge(STORAGE_KEY => all_features)
      end
      values
    end

    private

    def enabled_value?(value)
      value == true || value.to_s == '1' || value.to_s == 'true'
    end

    def stored_features
      settings = @settings_reader.plugin_redmine_canvas_gantt
      value = settings.is_a?(Hash) ? settings[STORAGE_KEY] : nil
      value.is_a?(Hash) ? value.transform_keys(&:to_s) : {}
    end

    def update_settings
      unless database_settings?
        SETTINGS_MUTEX.synchronize do
          current = @settings_reader.plugin_redmine_canvas_gantt
          @settings_reader.plugin_redmine_canvas_gantt = yield(current.is_a?(Hash) ? current.dup : {})
        end
        return
      end

      @settings_reader.transaction do
        setting = @settings_reader.lock.find_or_create_by!(name: SETTING_NAME)
        current = setting.value.is_a?(Hash) ? setting.value.dup : {}
        setting.value = yield(current)
        setting.save!
      end
      @settings_reader.clear_cache if @settings_reader.respond_to?(:clear_cache)
    rescue ActiveRecord::RecordNotUnique
      retry
    end

    def database_settings?
      @settings_reader.respond_to?(:transaction) && @settings_reader.respond_to?(:lock)
    end
  end
end
