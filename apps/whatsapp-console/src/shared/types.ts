export type Message = {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  time: string;
  attachmentName?: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  initials: string;
  color: string;
  lastSeen?: string;
  unreadCount: number;
  messages: Message[];
};

export type ConsoleSection = 'chats' | 'calls' | 'contacts';
