import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/Icon.js';
import type { Contact, Message } from '../shared/types.js';
import './inbox.css';

type InboxPageProps = {
  contacts: Contact[];
  activeContactId: string;
  onSelectContact: (id: string) => void;
  onSendMessage: (contactId: string, message: Message) => void;
  onStartCall: (contact: Contact) => void;
  onCreateContact: (input: { name: string; phone: string }) => void;
};

export function InboxPage({
  contacts,
  activeContactId,
  onSelectContact,
  onSendMessage,
  onStartCall,
  onCreateContact,
}: InboxPageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactError, setNewContactError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const messageStream = useRef<HTMLDivElement>(null);
  const activeContact =
    contacts.find((contact) => contact.id === activeContactId) ?? contacts[0];
  const filteredContacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (filter === 'unread' && contact.unreadCount === 0) return false;
      if (!normalizedQuery) return true;
      return (
        contact.name.toLowerCase().includes(normalizedQuery) ||
        contact.phone.includes(normalizedQuery) ||
        contact.messages.some((message) =>
          message.text.toLowerCase().includes(normalizedQuery),
        )
      );
    });
  }, [contacts, filter, query]);

  useEffect(() => {
    if (messageStream.current) {
      messageStream.current.scrollTop = messageStream.current.scrollHeight;
    }
  }, [activeContact?.id, activeContact?.messages.length]);

  function send(text: string, attachmentName?: string) {
    if (!activeContact || (!text.trim() && !attachmentName)) return;
    const message: Message = {
      id: crypto.randomUUID(),
      direction: 'outbound',
      text: text.trim() || `Shared ${attachmentName}`,
      time: new Intl.DateTimeFormat('en', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date()),
      ...(attachmentName ? { attachmentName } : {}),
    };
    onSendMessage(activeContact.id, message);
    setDraft('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) send('', file.name);
    event.currentTarget.value = '';
  }

  function handleCreateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newContactName.trim();
    const phone = newContactPhone.trim();
    if (!name || !/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
      setNewContactError('Enter a name and a valid phone number.');
      return;
    }
    onCreateContact({ name, phone });
    setNewContactName('');
    setNewContactPhone('');
    setNewContactError('');
    setNewContactOpen(false);
    setMobileThreadOpen(true);
  }

  if (!activeContact) {
    return <main className="inbox-empty">No conversations yet.</main>;
  }

  return (
    <main
      className={`inbox-layout${mobileThreadOpen ? ' inbox-layout--thread-open' : ''}`}
    >
      <aside className="conversation-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CUSTOMER CARE</p>
            <h1>Conversations</h1>
          </div>
          <button
            className="icon-button icon-button--soft"
            aria-label="New conversation"
            onClick={() => setNewContactOpen(true)}
          >
            <Icon name="plus" />
          </button>
        </div>
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search conversations"
            placeholder="Search name, number or message"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="conversation-filters" aria-label="Conversation filters">
          <button
            className={`filter-chip${filter === 'all' ? ' filter-chip--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`filter-chip${filter === 'unread' ? ' filter-chip--active' : ''}`}
            onClick={() => setFilter('unread')}
          >
            Unread
          </button>
        </div>
        <div className="conversation-list">
          {filteredContacts.map((contact) => {
            const lastMessage = contact.messages.at(-1);
            return (
              <button
                className={`conversation-row${contact.id === activeContactId ? ' conversation-row--active' : ''}`}
                key={contact.id}
                onClick={() => {
                  onSelectContact(contact.id);
                  setMobileThreadOpen(true);
                }}
              >
                <Avatar initials={contact.initials} color={contact.color} />
                <span className="conversation-row__body">
                  <span className="conversation-row__top">
                    <strong>{contact.name}</strong>
                    <time>{lastMessage?.time}</time>
                  </span>
                  <span className="conversation-row__bottom">
                    <span>{lastMessage?.text}</span>
                    {contact.unreadCount > 0 && (
                      <span className="unread-count">
                        {contact.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {filteredContacts.length === 0 && (
            <p className="list-empty">No conversations match that search.</p>
          )}
        </div>
        <div className="panel-footnote">
          <span className="status-dot" />
          Preview data · Meta connection not configured
        </div>
      </aside>

      <section
        className="chat-panel"
        aria-label={`Conversation with ${activeContact.name}`}
      >
        <header className="chat-header">
          <button
            className="icon-button mobile-back-button"
            aria-label="Back to conversations"
            onClick={() => setMobileThreadOpen(false)}
          >
            <Icon name="back" />
          </button>
          <Avatar
            initials={activeContact.initials}
            color={activeContact.color}
          />
          <button
            className="chat-contact"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <strong>{activeContact.name}</strong>
            <span>{activeContact.lastSeen}</span>
          </button>
          <div className="chat-header__actions">
            <button
              className="icon-button"
              aria-label="Start voice call"
              onClick={() => onStartCall(activeContact)}
            >
              <Icon name="phone" />
            </button>
            <button
              className={`icon-button${detailsOpen ? ' icon-button--selected' : ''}`}
              aria-label="Toggle contact details"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <Icon name="info" />
            </button>
          </div>
        </header>

        <div className="message-stream" ref={messageStream}>
          <div className="day-divider">
            <span>Today</span>
          </div>
          {activeContact.messages.map((message) => (
            <article
              className={`message message--${message.direction}`}
              key={message.id}
            >
              <div className="message__bubble">
                {message.attachmentName && (
                  <span className="message__attachment">
                    <Icon name="paperclip" />
                    {message.attachmentName}
                  </span>
                )}
                <span>{message.text}</span>
                <time>
                  {message.time}
                  {message.direction === 'outbound' && (
                    <Icon className="message__check" name="check" />
                  )}
                </time>
              </div>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            onChange={handleFileChange}
          />
          <button
            className="icon-button"
            type="button"
            aria-label="Attach a file"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="paperclip" />
          </button>
          <input
            aria-label="Write a message"
            placeholder="Write a message..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="icon-button"
            type="button"
            aria-label="Emoji picker (preview)"
            onClick={() => setDraft((current) => `${current}🙂`)}
          >
            <Icon name="smile" />
          </button>
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim()}
          >
            <Icon name="send" />
          </button>
        </form>
      </section>

      {detailsOpen && (
        <aside className="details-panel">
          <div className="details-panel__heading">
            <h2>Contact details</h2>
            <button
              className="icon-button"
              aria-label="Close contact details"
              onClick={() => setDetailsOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <Avatar
            initials={activeContact.initials}
            color={activeContact.color}
            size="large"
          />
          <h3>{activeContact.name}</h3>
          <p>{activeContact.phone}</p>
          <div className="details-card">
            <span>Customer channel</span>
            <strong>WhatsApp Business</strong>
          </div>
          <div className="details-card">
            <span>Conversation owner</span>
            <strong>TutWithUs Support</strong>
          </div>
        </aside>
      )}
      {newContactOpen && (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="new-chat-dialog"
            onSubmit={handleCreateContact}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-chat-title"
          >
            <div className="new-chat-dialog__heading">
              <div>
                <p className="eyebrow">CUSTOMER CARE</p>
                <h2 id="new-chat-title">Start a conversation</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close dialog"
                onClick={() => setNewContactOpen(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <label>
              <span>Customer name</span>
              <input
                autoFocus
                value={newContactName}
                onChange={(event) => setNewContactName(event.target.value)}
                placeholder="Name"
              />
            </label>
            <label>
              <span>WhatsApp phone number</span>
              <input
                value={newContactPhone}
                onChange={(event) => setNewContactPhone(event.target.value)}
                placeholder="+961 70 000 000"
              />
            </label>
            {newContactError && <p className="form-error">{newContactError}</p>}
            <button className="dialog-submit" type="submit">
              Create preview chat
            </button>
            <p className="dialog-note">
              This only creates a local preview contact.
            </p>
          </form>
        </div>
      )}
    </main>
  );
}
