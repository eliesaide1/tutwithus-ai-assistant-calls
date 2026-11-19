import { useState } from 'react';
import { CallsPage } from './screen/CallsPage.js';
import { CallOverlay } from './screen/CallOverlay.js';
import { ContactsPage } from './screen/ContactsPage.js';
import { InboxPage } from './screen/InboxPage.js';
import { Avatar } from './components/Avatar.js';
import { Icon, type IconName } from './components/Icon.js';
import { DEMO_CONTACTS } from './shared/data/demo-data.js';
import type { Contact, ConsoleSection, Message } from './shared/types.js';
import './App.css';

const navigation: { id: ConsoleSection; label: string; icon: IconName }[] = [
  { id: 'chats', label: 'Chats', icon: 'chat' },
  { id: 'calls', label: 'Calls', icon: 'phone' },
  { id: 'contacts', label: 'Contacts', icon: 'users' },
];

export function App() {
  const [section, setSection] = useState<ConsoleSection>('chats');
  const [contacts, setContacts] = useState(DEMO_CONTACTS);
  const [activeContactId, setActiveContactId] = useState(DEMO_CONTACTS[0]!.id);
  const [callingContact, setCallingContact] = useState<Contact | null>(null);
  const activeContact =
    contacts.find((contact) => contact.id === activeContactId) ?? contacts[0]!;

  function sendMessage(contactId: string, message: Message) {
    setContacts((current) =>
      current.map((contact) =>
        contact.id === contactId
          ? {
              ...contact,
              unreadCount: 0,
              messages: [...contact.messages, message],
            }
          : contact,
      ),
    );
  }

  function openChat(contactId: string) {
    setActiveContactId(contactId);
    setSection('chats');
    setContacts((current) =>
      current.map((contact) =>
        contact.id === contactId ? { ...contact, unreadCount: 0 } : contact,
      ),
    );
  }

  return (
    <div className="app-shell">
      <aside className="app-rail">
        <div className="brand-mark">
          <img src="/tutwithus-logo.02823068.png" alt="TutWithUs Connect" />
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-item${section === item.id ? ' nav-item--active' : ''}`}
              key={item.id}
              aria-label={item.label}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="app-rail__bottom">
          <span className="operator-avatar" title="Support team">
            TS
          </span>
        </div>
      </aside>

      {section === 'chats' && (
        <InboxPage
          contacts={contacts}
          activeContactId={activeContactId}
          onSelectContact={openChat}
          onSendMessage={sendMessage}
          onStartCall={setCallingContact}
          onCreateContact={({ name, phone }) => {
            const id = crypto.randomUUID();
            const initials = name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0] ?? '')
              .join('')
              .toUpperCase();
            const contact: Contact = {
              id,
              name,
              phone,
              initials,
              color: 'teal',
              lastSeen: 'New contact',
              unreadCount: 0,
              messages: [],
            };
            setContacts((current) => [contact, ...current]);
            setActiveContactId(id);
          }}
        />
      )}
      {section === 'calls' && (
        <CallsPage contacts={contacts} onStartCall={setCallingContact} />
      )}
      {section === 'contacts' && (
        <ContactsPage
          contacts={contacts}
          onOpenChat={openChat}
          onStartCall={setCallingContact}
        />
      )}

      {callingContact && (
        <CallOverlay
          contact={callingContact}
          onEnd={() => setCallingContact(null)}
        />
      )}
      <div className="app-watermark" aria-hidden="true">
        <Avatar
          initials={activeContact.initials}
          color={activeContact.color}
          size="small"
        />
      </div>
    </div>
  );
}
