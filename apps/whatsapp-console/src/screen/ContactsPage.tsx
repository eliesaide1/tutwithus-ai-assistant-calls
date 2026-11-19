import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import type { Contact } from '../shared/types.js';
import './contacts.css';

type ContactsPageProps = {
  contacts: Contact[];
  onOpenChat: (id: string) => void;
  onStartCall: (contact: Contact) => void;
};

export function ContactsPage({
  contacts,
  onOpenChat,
  onStartCall,
}: ContactsPageProps) {
  return (
    <main className="contacts-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CUSTOMER CARE</p>
          <h1>Contacts</h1>
          <p className="page-heading__description">
            People who have contacted your business account.
          </p>
        </div>
        <span className="preview-label">Preview data</span>
      </header>
      <section className="contacts-list" aria-label="Customer contacts">
        {contacts.map((contact) => (
          <article className="contact-row" key={contact.id}>
            <Avatar initials={contact.initials} color={contact.color} />
            <div className="contact-row__identity">
              <strong>{contact.name}</strong>
              <span>{contact.phone}</span>
            </div>
            <div className="contact-row__actions">
              <button
                className="secondary-button"
                aria-label={`Message ${contact.name}`}
                onClick={() => onOpenChat(contact.id)}
              >
                <Icon name="chat" />
              </button>
              <button
                className="icon-button icon-button--soft"
                aria-label={`Call ${contact.name}`}
                onClick={() => onStartCall(contact)}
              >
                <Icon name="phone" />
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
