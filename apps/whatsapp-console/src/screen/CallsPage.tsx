import { useState } from 'react';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import { DEMO_CALLS } from '../shared/data/demo-data.js';
import type { Contact } from '../shared/types.js';
import './calls.css';

type CallsPageProps = {
  contacts: Contact[];
  onStartCall: (contact: Contact) => void;
};

export function CallsPage({ contacts, onStartCall }: CallsPageProps) {
  const [missedOnly, setMissedOnly] = useState(false);
  const visibleCalls = missedOnly
    ? DEMO_CALLS.filter((call) => call.outcome === 'Missed')
    : DEMO_CALLS;

  return (
    <main className="calls-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER CARE</p>
          <h1>Calls</h1>
          <p className="page-heading__description">
            Review recent conversations and call a customer.
          </p>
        </div>
        <span className="preview-label">Preview data</span>
      </header>
      <section className="calls-section">
        <div className="section-title">
          <h2>Recent calls</h2>
          <button
            className="text-button"
            aria-pressed={missedOnly}
            onClick={() => setMissedOnly((current) => !current)}
          >
            <Icon name="filter" /> {missedOnly ? 'Showing missed' : 'All calls'}
          </button>
        </div>
        <div className="call-list">
          {visibleCalls.map((call) => {
            const contact = contacts.find((item) => item.id === call.contactId);
            if (!contact) return null;
            const missed = call.outcome === 'Missed';
            return (
              <article className="call-row" key={call.id}>
                <Avatar initials={contact.initials} color={contact.color} />
                <div className="call-row__identity">
                  <strong>{contact.name}</strong>
                  <span className={missed ? 'call-row__missed' : ''}>
                    <Icon
                      name={
                        call.direction === 'Incoming'
                          ? 'arrowDownLeft'
                          : 'arrowUpRight'
                      }
                    />
                    {call.direction} call
                  </span>
                </div>
                <span className="call-row__time">{call.time}</span>
                <span className="call-row__duration">{call.duration}</span>
                <button
                  className="icon-button icon-button--soft"
                  aria-label={`Call ${contact.name}`}
                  onClick={() => onStartCall(contact)}
                >
                  <Icon name="phone" />
                </button>
              </article>
            );
          })}
          {visibleCalls.length === 0 && (
            <p className="list-empty">There are no missed calls.</p>
          )}
        </div>
      </section>
      <section className="calls-section">
        <div className="section-title">
          <h2>Quick contacts</h2>
          <span>{contacts.length} contacts</span>
        </div>
        <div className="quick-contacts">
          {contacts.slice(0, 4).map((contact) => (
            <button
              className="quick-contact"
              key={contact.id}
              onClick={() => onStartCall(contact)}
            >
              <Avatar initials={contact.initials} color={contact.color} />
              <span>
                <strong>{contact.name}</strong>
                <small>{contact.phone}</small>
              </span>
              <Icon name="phone" />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
