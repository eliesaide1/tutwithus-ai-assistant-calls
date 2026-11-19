import type { Contact } from '../types.js';

export const DEMO_CONTACTS: Contact[] = [
  {
    id: 'maya',
    name: 'Maya Haddad',
    phone: '+961 70 555 014',
    initials: 'MH',
    color: 'violet',
    lastSeen: 'Active recently',
    unreadCount: 2,
    messages: [
      {
        id: 'maya-1',
        direction: 'inbound',
        text: 'Hello! I am looking for a math tutor for my daughter.',
        time: '10:24',
      },
      {
        id: 'maya-2',
        direction: 'outbound',
        text: 'Hi Maya, happy to help. What grade is she in?',
        time: '10:26',
      },
      {
        id: 'maya-3',
        direction: 'inbound',
        text: 'She is in grade 8 and needs help with algebra.',
        time: '10:27',
      },
      {
        id: 'maya-4',
        direction: 'inbound',
        text: 'Could we arrange a short call to discuss the schedule?',
        time: '10:28',
      },
    ],
  },
  {
    id: 'omar',
    name: 'Omar Nasser',
    phone: '+961 76 555 028',
    initials: 'ON',
    color: 'blue',
    lastSeen: 'Active 12 minutes ago',
    unreadCount: 0,
    messages: [
      {
        id: 'omar-1',
        direction: 'inbound',
        text: 'Thank you for sending the course details.',
        time: '09:52',
      },
      {
        id: 'omar-2',
        direction: 'outbound',
        text: 'You are welcome. Let us know if you have any questions.',
        time: '09:54',
      },
    ],
  },
  {
    id: 'layla',
    name: 'Layla Saad',
    phone: '+961 71 555 039',
    initials: 'LS',
    color: 'coral',
    lastSeen: 'Active yesterday',
    unreadCount: 0,
    messages: [
      {
        id: 'layla-1',
        direction: 'outbound',
        text: 'Your tutor availability request has been received.',
        time: 'Yesterday',
      },
    ],
  },
  {
    id: 'karim',
    name: 'Karim Mansour',
    phone: '+961 03 555 062',
    initials: 'KM',
    color: 'gold',
    lastSeen: 'Active recently',
    unreadCount: 1,
    messages: [
      {
        id: 'karim-1',
        direction: 'inbound',
        text: 'Can I speak to someone about rescheduling?',
        time: 'Yesterday',
      },
    ],
  },
  {
    id: 'nour',
    name: 'Nour Khalil',
    phone: '+961 81 555 071',
    initials: 'NK',
    color: 'teal',
    lastSeen: 'Active this week',
    unreadCount: 0,
    messages: [
      {
        id: 'nour-1',
        direction: 'inbound',
        text: 'The session went really well, thank you!',
        time: 'Mon',
      },
    ],
  },
];

export const DEMO_CALLS = [
  {
    id: 'call-1',
    contactId: 'maya',
    direction: 'Incoming',
    time: '10:18',
    duration: '04:32',
    outcome: 'Completed',
  },
  {
    id: 'call-2',
    contactId: 'karim',
    direction: 'Missed',
    time: 'Yesterday',
    duration: '—',
    outcome: 'Missed',
  },
  {
    id: 'call-3',
    contactId: 'omar',
    direction: 'Outgoing',
    time: 'Mon',
    duration: '02:16',
    outcome: 'Completed',
  },
] as const;
