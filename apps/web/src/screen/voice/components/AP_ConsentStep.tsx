import './AP_ConsentStep.css';
import { AP_FormField } from '../../../components/ui/AP_FormField';

type AP_ConsentStepProps = {
  heading: string;
  consentText: string;
  phoneLabel: string;
  memberIdLabel: string;
  acknowledgeLabel: string;
  startLabel: string;
  acknowledged: boolean;
  isStarting: boolean;
  error: string | null;
  onAcknowledgeChange: (acknowledged: boolean) => void;
  onStart: () => void;
  phone: string;
  onPhoneChange: (phone: string) => void;
  memberId: string;
  onMemberIdChange: (memberId: string) => void;
};

export function AP_ConsentStep({
  heading,
  consentText,
  phoneLabel,
  memberIdLabel,
  acknowledgeLabel,
  startLabel,
  acknowledged,
  isStarting,
  error,
  onAcknowledgeChange,
  onStart,
  phone,
  onPhoneChange,
  memberId,
  onMemberIdChange,
}: AP_ConsentStepProps) {
  const hasPhone = Boolean(phone.trim());
  const hasMemberId = Boolean(memberId.trim());
  const credentialsComplete = hasPhone === hasMemberId;
  return (
    <section
      aria-labelledby="ap-consent-step-heading"
      className="ap-consent-step"
    >
      <h2 id="ap-consent-step-heading">{heading}</h2>

      <div className="ap-consent-step__notice">
        <p>{consentText}</p>
      </div>

      <form
        className="ap-consent-step__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (acknowledged && credentialsComplete && !isStarting) {
            onStart();
          }
        }}
      >
        <AP_FormField label={phoneLabel}>
          <input
            autoComplete="tel"
            inputMode="tel"
            maxLength={24}
            minLength={8}
            onChange={(event) => onPhoneChange(event.target.value)}
            pattern="(?=.*\d)\+?(?:[\d\s]|\(|\)|\.|-)+"
            type="tel"
            value={phone}
          />
        </AP_FormField>
        <AP_FormField label={memberIdLabel}>
          <input
            autoComplete="off"
            maxLength={128}
            onChange={(event) => onMemberIdChange(event.target.value)}
            type="text"
            value={memberId}
          />
        </AP_FormField>
        <label className="ap-consent-step__choice">
          <input
            checked={acknowledged}
            onChange={(event) =>
              onAcknowledgeChange(event.currentTarget.checked)
            }
            required
            type="checkbox"
          />
          <span>{acknowledgeLabel}</span>
        </label>

        {error && (
          <p className="ap-consent-step__error" role="alert">
            {error}
          </p>
        )}

        <button
          className="ap-consent-step__submit"
          disabled={!acknowledged || !credentialsComplete || isStarting}
          type="submit"
        >
          {startLabel}
        </button>
      </form>
    </section>
  );
}
