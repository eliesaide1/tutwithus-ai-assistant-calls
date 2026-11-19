import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'chat'
  | 'phone'
  | 'users'
  | 'search'
  | 'more'
  | 'info'
  | 'send'
  | 'paperclip'
  | 'smile'
  | 'close'
  | 'back'
  | 'mic'
  | 'volume'
  | 'phoneOff'
  | 'check'
  | 'plus'
  | 'filter'
  | 'arrowUpRight'
  | 'arrowDownLeft'
  | 'clock';

const paths: Record<IconName, ReactNode> = {
  chat: (
    <>
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" />
    </>
  ),
  phone: (
    <path d="M7.2 3.5 4.7 5c-.9.6-.7 2.4.4 4.7a21 21 0 0 0 9.2 9.2c2.3 1.1 4.1 1.3 4.7.4l1.5-2.5-4.1-2.4-1.6 1.6a15 15 0 0 1-6.7-6.7l1.6-1.6L7.2 3.5Z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.2a3 3 0 0 1 0 5.6M18 14a5 5 0 0 1 3 4.6V20" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  more: <path d="M5 10h.01M12 10h.01M19 10h.01" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  send: <path d="m21 3-7.2 18-3.7-7.1L3 10.2 21 3ZM10.1 13.9 21 3" />,
  paperclip: (
    <path d="m8 12.5 6.7-6.7a3.2 3.2 0 0 1 4.5 4.5l-8.8 8.8a5 5 0 0 1-7.1-7.1l8.4-8.4" />
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.3 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  back: <path d="m15 18-6-6 6-6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </>
  ),
  volume: (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
      <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
    </>
  ),
  phoneOff: (
    <>
      <path d="M4 4 20 20M7 3.5 4.7 5c-.7.5-.7 1.6-.2 3M14.4 15.6l1.4-1.4 4.1 2.4-1.5 2.5c-.6.9-2.4.7-4.7-.4a20 20 0 0 1-4-2.8" />
      <path d="M8.2 8.2a14 14 0 0 0 3.6 5.9" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  arrowUpRight: <path d="M7 17 17 7M7 7h10v10" />,
  arrowDownLeft: <path d="M17 7 7 17m10 0H7V7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
