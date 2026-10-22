/** 极简内联 SVG 图标集（24×24，默认 16px、1.5 描边，currentColor）。无外部依赖。 */
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5" rx="2" /><rect x="13.5" y="11" width="7.5" height="10" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></>,
  hot: <path d="M12 21c4 0 7-2.7 7-6.6 0-2.9-1.6-5.2-3.4-7-.4 1.7-1.3 3-2.6 3.6C13.4 7.6 12 4.6 9.6 3c.2 2.6-1 4.6-2.6 6.3C5.6 10.8 5 12.6 5 14.4 5 18.3 8 21 12 21Z" />,
  library: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v13A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5Z" /><path d="M10 8h4M10 16h4" /><path d="m14.6 5.2 2.9-.8a1.5 1.5 0 0 1 1.8 1.1l2.6 11.6a1.5 1.5 0 0 1-1.1 1.8l-2.9.7" /></>,
  topics: <><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /><circle cx="12" cy="12" r="3.2" /></>,
  review: <><path d="M20 12a8 8 0 1 1-4.7-7.3" /><path d="m8.5 11.5 3 3L20 6" /></>,
  creator: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /><path d="m10 9.5 2-2 2 2M12 7.5v5" /></>,
  analytics: <><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7.5" y="11" width="3" height="6" rx="1" /><rect x="12.5" y="7" width="3" height="10" rx="1" /><rect x="17.5" y="13" width="2.5" height="4" rx="1" /></>,
  agent: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="m10 12-2 2 2 2M14 12l2 2-2 2" /></>,
  improve: <><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16" /><path d="M20 20v-4h-4" /></>,
  plugins: <path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h-1.5a2 2 0 1 0 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3Z" />,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2" /><circle cx="5" cy="18" r="1.2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" /><path d="M10.3 20a2 2 0 0 0 3.4 0" /></>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <path d="M7 17 17 7M8 7h9v9" />,
  arrowDown: <path d="M7 7l10 10M17 8v9H8" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></>,
  more: <><circle cx="5.5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18.5" cy="12" r="1.3" /></>,
  wifiOff: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M19 13a10 10 0 0 0-2.5-1.7M2 9.5a15 15 0 0 1 4-2.6M22 9.5A15 15 0 0 0 11 5.1" /><circle cx="12" cy="20" r=".8" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6Z" /><path d="m9 12 2 2 4-4" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M9 8.5 12 12l3-3.5M12 12v5M9.5 13h5M9.5 15.5h5" /></>,
  activity: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  inbox: <><path d="M3 13.5 5.5 5h13l2.5 8.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></>,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3.5 2.5 20h19Z" /><path d="M12 10v4.5M12 17.3v.2" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.2" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, strokeWidth = 1.5 }: { name: IconName | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name] ?? P.overview}
    </svg>
  );
}
