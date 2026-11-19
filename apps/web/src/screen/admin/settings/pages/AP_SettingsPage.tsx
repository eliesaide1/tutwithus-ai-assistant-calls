import { useRef, useState } from 'react';
import type {
  AgentSettings,
  AgentSettingsDraftRequest,
} from '@tutwithus/contracts/admin';
import { AP_Button } from '../../../../components/ui/AP_Button.js';
import { AP_FormField } from '../../../../components/ui/AP_FormField.js';
import type { Locale, messages } from '../../../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../../../components/ui/AP_LoadingIndicator.js';

type AdminText = (typeof messages)['en'];
type LanguageOption = { value: Locale; label: string };

type AP_SettingsPageProps = {
  text: AdminText;
  settingsActive: AgentSettings | null;
  settingsDrafts: AgentSettings[];
  settingsDraft: AgentSettingsDraftRequest;
  settingsEditingVersion: number | null;
  languageOptions: LanguageOption[];
  loading: boolean;
  busyAction: string | null;
  onDraftChange: <K extends keyof AgentSettingsDraftRequest>(
    key: K,
    value: AgentSettingsDraftRequest[K],
  ) => void;
  onGreetingChange: (locale: Locale, greeting: string) => void;
  onEscalationChange: (value: string) => void;
  onSave: () => void;
  onNew: () => void;
  onEdit: (version: AgentSettings) => void;
  onDelete: (version: AgentSettings) => void;
  onActivate: (version: number) => void;
};

const voices = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

export function AP_SettingsPage({
  text,
  settingsActive,
  settingsDrafts,
  settingsDraft,
  settingsEditingVersion,
  languageOptions,
  loading,
  busyAction,
  onDraftChange,
  onGreetingChange,
  onEscalationChange,
  onSave,
  onNew,
  onEdit,
  onDelete,
  onActivate,
}: AP_SettingsPageProps) {
  const [unavailableSamples, setUnavailableSamples] = useState<
    Record<string, boolean>
  >({});
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const versions = [
    ...(settingsActive ? [settingsActive] : []),
    ...settingsDrafts.filter(
      (version) => version.version !== settingsActive?.version,
    ),
  ].sort((left, right) => right.version - left.version);

  function stopOtherPreviews(activeVoice: string) {
    audioRefs.current.forEach((audio, voice) => {
      if (voice !== activeVoice) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }

  return (
    <div className="ap-admin-settings-page">
      <header className="ap-admin-settings-header">
        <div>
          <h2>{text.adminSettings}</h2>
          <p>{text.adminSettingsDescription}</p>
        </div>
        <div className="ap-admin-settings-heading__actions">
          {settingsActive && (
            <span className="ap-admin-record__status ap-admin-record__status--active">
              {text.adminActiveVersion}: v{settingsActive.version}
            </span>
          )}
          <AP_Button onClick={onNew}>{text.adminNewDraft}</AP_Button>
        </div>
      </header>
      {loading ? (
        <AP_LoadingIndicator
          label={text.adminLoadingRecords}
          variant="section"
        />
      ) : (
        <>
          <form
            className="ap-admin-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <section className="ap-admin-settings-section">
              <header className="ap-admin-settings-section__heading">
                <h3>
                  {settingsEditingVersion === null
                    ? text.adminNewDraft
                    : text.adminSettingsEditorTitle.replace(
                        '{version}',
                        `${settingsEditingVersion}`,
                      )}
                </h3>
                <p>
                  {settingsEditingVersion === null
                    ? text.adminSettingsBasicsHelp
                    : text.adminSettingsEditorHelp}
                </p>
              </header>
              <div className="ap-admin-settings-section__fields">
                <AP_FormField
                  label={text.adminDraftName}
                  hint={text.adminDraftNameHelp}
                  className="ap-admin-settings-form__wide"
                >
                  <input
                    maxLength={80}
                    required
                    value={settingsDraft.name}
                    onChange={(event) =>
                      onDraftChange('name', event.currentTarget.value)
                    }
                  />
                </AP_FormField>
                {languageOptions.map((option) => (
                  <AP_FormField
                    key={option.value}
                    label={`${text.adminGreeting} · ${option.label}`}
                    hint={text.adminGreetingHelp}
                  >
                    <input
                      maxLength={500}
                      required
                      value={settingsDraft.greeting[option.value]}
                      onChange={(event) =>
                        onGreetingChange(
                          option.value,
                          event.currentTarget.value,
                        )
                      }
                    />
                  </AP_FormField>
                ))}
              </div>
            </section>
            <section className="ap-admin-settings-section">
              <header className="ap-admin-settings-section__heading">
                <h3>{text.adminSettingsInstructionsTitle}</h3>
                <p>{text.adminSettingsInstructionsHelp}</p>
              </header>
              <AP_FormField
                label={text.adminInstructionTemplate}
                hint={text.adminInstructionTemplateHelp}
                className="ap-admin-settings-form__wide"
              >
                <textarea
                  maxLength={8000}
                  required
                  rows={5}
                  value={settingsDraft.instructionTemplate}
                  onChange={(event) =>
                    onDraftChange(
                      'instructionTemplate',
                      event.currentTarget.value,
                    )
                  }
                />
              </AP_FormField>
            </section>
            <section className="ap-admin-settings-section">
              <header className="ap-admin-settings-section__heading">
                <h3>{text.adminSettingsVoiceTitle}</h3>
                <p>{text.adminVoiceHelp}</p>
              </header>
              <fieldset className="ap-admin-voice-picker">
                <legend>{text.adminVoice}</legend>
                <div className="ap-admin-voice-picker__grid">
                  {voices.map((voice) => (
                    <label
                      className={`ap-admin-voice-option${settingsDraft.voice === voice ? ' ap-admin-voice-option--selected' : ''}`}
                      key={voice}
                    >
                      <input
                        type="radio"
                        name="agent-voice"
                        value={voice}
                        checked={settingsDraft.voice === voice}
                        onChange={() => onDraftChange('voice', voice)}
                      />
                      <span className="ap-admin-voice-option__name">
                        {voice}
                      </span>
                      <audio
                        controls
                        preload="none"
                        src={`/voice-samples/${voice}.mp3`}
                        ref={(audio) => {
                          if (audio) {
                            audioRefs.current.set(voice, audio);
                          } else {
                            audioRefs.current.delete(voice);
                          }
                        }}
                        aria-label={text.adminVoicePreview.replace(
                          '{voice}',
                          voice,
                        )}
                        onPlay={() => stopOtherPreviews(voice)}
                        onError={() =>
                          setUnavailableSamples((current) => ({
                            ...current,
                            [voice]: true,
                          }))
                        }
                      />
                      {unavailableSamples[voice] && (
                        <small>{text.adminVoiceSampleMissing}</small>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
            <section className="ap-admin-settings-section">
              <header className="ap-admin-settings-section__heading">
                <h3>{text.adminSettingsCallTitle}</h3>
                <p>{text.adminSettingsCallHelp}</p>
              </header>
              <div className="ap-admin-settings-section__fields">
                <AP_FormField
                  label={text.adminMaxCallSec}
                  hint={text.adminMaxCallSecHelp}
                >
                  <input
                    type="number"
                    min={0.5}
                    max={30}
                    step={0.5}
                    required
                    value={settingsDraft.maxCallSec / 60}
                    onChange={(event) =>
                      onDraftChange(
                        'maxCallSec',
                        Number(event.currentTarget.value) * 60,
                      )
                    }
                  />
                </AP_FormField>
                <AP_FormField
                  label={text.adminBusinessHours}
                  hint={text.adminBusinessHoursHelp}
                >
                  <input
                    maxLength={1000}
                    required
                    value={settingsDraft.businessHours}
                    onChange={(event) =>
                      onDraftChange('businessHours', event.currentTarget.value)
                    }
                  />
                </AP_FormField>
                <AP_FormField
                  label={text.adminEscalationMessage}
                  hint={text.adminEscalationMessageHelp}
                  className="ap-admin-settings-form__wide"
                >
                  <textarea
                    maxLength={1000}
                    required
                    rows={3}
                    value={settingsDraft.escalation.hoursText}
                    onChange={(event) =>
                      onEscalationChange(event.currentTarget.value)
                    }
                  />
                </AP_FormField>
              </div>
            </section>
            <div className="ap-admin-settings-form__actions ap-admin-settings-form__wide">
              <AP_Button
                variant="primary"
                type="submit"
                disabled={busyAction === 'settings-save'}
              >
                {settingsEditingVersion === null
                  ? text.adminSaveDraft
                  : text.adminUpdateDraft}
              </AP_Button>
              {settingsEditingVersion !== null && (
                <span>
                  {text.adminEditingDraft.replace(
                    '{version}',
                    `${settingsEditingVersion}`,
                  )}
                </span>
              )}
            </div>
          </form>

          <section className="ap-admin-versions">
            <header className="ap-admin-settings-section__heading">
              <h3>{text.adminCurrentVersions}</h3>
              <p>{text.adminSettingsVersionsHelp}</p>
            </header>
            {versions.length === 0 ? (
              <p className="ap-admin-operations__empty">{text.adminNoDrafts}</p>
            ) : (
              <div className="ap-admin-versions__table-wrap">
                <table className="ap-admin-versions__table">
                  <thead>
                    <tr>
                      <th scope="col">{text.adminVersion}</th>
                      <th scope="col">{text.adminDraftName}</th>
                      <th scope="col">{text.adminVersionStatus}</th>
                      <th scope="col">{text.adminVoice}</th>
                      <th scope="col">{text.adminUpdatedAt}</th>
                      <th scope="col">{text.adminVersionActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => (
                      <tr
                        key={version.version}
                        className={
                          settingsEditingVersion === version.version
                            ? 'ap-admin-version--selected'
                            : undefined
                        }
                      >
                        <td className="ap-admin-versions__number">
                          v{version.version}
                        </td>
                        <td className="ap-admin-versions__name">
                          {version.name ?? text.adminUnnamedDraft}
                        </td>
                        <td>
                          <span
                            className={`ap-admin-version-status ap-admin-version-status--${version.status}`}
                          >
                            {version.status === 'active'
                              ? text.adminStatusActive
                              : version.status === 'draft'
                                ? text.adminStatusDraft
                                : text.adminStatusArchived}
                          </span>
                        </td>
                        <td>
                          <span className="ap-admin-version__voice">
                            {version.voice}
                          </span>
                        </td>
                        <td className="ap-admin-version__updated">
                          {new Date(version.updatedAt).toLocaleDateString(
                            undefined,
                            {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            },
                          )}
                        </td>
                        <td>
                          <div className="ap-admin-version__actions">
                            <AP_Button
                              disabled={
                                busyAction === `settings-${version.version}`
                              }
                              onClick={() => onEdit(version)}
                            >
                              {version.status === 'draft'
                                ? text.adminEditDraft
                                : text.adminCreateDraftFromVersion}
                            </AP_Button>
                            {version.status !== 'active' && (
                              <AP_Button
                                variant="primary"
                                disabled={
                                  busyAction === `settings-${version.version}`
                                }
                                onClick={() => onActivate(version.version)}
                              >
                                {text.adminActivate}
                              </AP_Button>
                            )}
                            <AP_Button
                              variant="danger"
                              disabled={
                                busyAction ===
                                `settings-delete-${version.version}`
                              }
                              onClick={() => onDelete(version)}
                            >
                              {text.adminDeleteVersion}
                            </AP_Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
