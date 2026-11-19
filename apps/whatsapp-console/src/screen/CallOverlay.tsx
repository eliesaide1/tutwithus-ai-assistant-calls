import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import type { Contact } from '../shared/types.js';

type CallOverlayProps = {
  contact: Contact;
  onEnd: () => void;
};

export function CallOverlay({ contact, onEnd }: CallOverlayProps) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [connected]);

  const duration = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-name"
    >
      <div className="call-card">
        <button
          className="call-card__close"
          aria-label="Close call"
          onClick={onEnd}
        >
          <Icon name="close" />
        </button>
        <p className="eyebrow">TUTWITHUS CONNECT · PREVIEW</p>
        <Avatar
          initials={contact.initials}
          color={contact.color}
          size="large"
        />
        <h2 id="call-name">{contact.name}</h2>
        <p className="call-card__phone">{contact.phone}</p>
        <p className="call-card__state">
          {connected ? `Connected · ${duration}` : 'Connecting preview call…'}
        </p>
        <div className="call-controls">
          {connected && (
            <button
              className={`call-control${muted ? ' call-control--active' : ''}`}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
              onClick={() => setMuted((value) => !value)}
            >
              <Icon name="mic" />
              <span>{muted ? 'Muted' : 'Mute'}</span>
            </button>
          )}
          {connected ? (
            <button
              className="call-control call-control--end"
              aria-label="End call"
              onClick={onEnd}
            >
              <Icon name="phoneOff" />
              <span>End</span>
            </button>
          ) : (
            <>
              <button
                className="call-control call-control--end"
                aria-label="Cancel call"
                onClick={onEnd}
              >
                <Icon name="phoneOff" />
                <span>Cancel</span>
              </button>
              <button
                className="call-control call-control--answer"
                aria-label="Connect preview call"
                onClick={() => setConnected(true)}
              >
                <Icon name="phone" />
                <span>Connect</span>
              </button>
            </>
          )}
        </div>
        <p className="call-card__notice">
          This is a UI preview. Live calling is not connected.
        </p>
      </div>
    </div>
  );
}
