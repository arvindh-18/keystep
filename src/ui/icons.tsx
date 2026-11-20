import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

export const Icon = {
  Play: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></svg>,
  Pause: ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></svg>,
  Stop: ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" /></svg>,
  Restart: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>,
  Prev: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 5v14" /><path d="M18 6l-8 6 8 6z" fill="currentColor" /></svg>,
  Next: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M18 5v14" /><path d="M6 6l8 6-8 6z" fill="currentColor" /></svg>,
  Loop: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>,
  Metronome: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-8" /><path d="M7.5 15h9" /></svg>,
  Volume: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>,
  Settings: ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  Library: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>,
  Sliders: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>,
  Chart: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>,
  Plug: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></svg>,
  Close: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  Upload: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>,
  Star: ({ size, filled, ...p }: P & { filled?: boolean }) => <svg {...base(size)} {...p}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" fill={filled ? 'currentColor' : 'none'} /></svg>,
  Trash: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  Edit: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>,
  Fullscreen: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  Search: ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  Undo: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>,
  Skip: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M5 5l9 7-9 7z" /><path d="M19 5v14" /></svg>,
  Download: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>,
  Panel: ({ size, ...p }: P) => <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>,
  Record: ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" /></svg>,
  Takes: ({ size, ...p }: P) => <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>,
  Headphones: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="5" height="7" rx="1.5" /><rect x="16" y="14" width="5" height="7" rx="1.5" /></svg>,
  Pedal: ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M7 20h10l-2-9H9z" /><path d="M12 11V4" /></svg>,
};
