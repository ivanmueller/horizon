/* Lucide icon set used by the dashboard, inlined to avoid a CDN dep
   for cards that need to render offline. Stroke 1.75 to match the
   dashboard's existing visual rhythm. Each is a render-prop component. */

const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
       dangerouslySetInnerHTML={{ __html: d }} />
);

const I = {
  home:     ({ size }) => <Icon size={size} d='<path d="M3 9 12 2l9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' />,
  calendar: ({ size }) => <Icon size={size} d='<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>' />,
  dollar:   ({ size }) => <Icon size={size} d='<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' />,
  qr:       ({ size }) => <Icon size={size} d='<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>' />,
  users:    ({ size }) => <Icon size={size} d='<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' />,
  search:   ({ size }) => <Icon size={size} d='<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' />,
  download: ({ size }) => <Icon size={size} d='<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' />,
  refresh:  ({ size }) => <Icon size={size} d='<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' />,
  bell:     ({ size }) => <Icon size={size} d='<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' />,
  trend:    ({ size }) => <Icon size={size} d='<polyline points="22 6 13.5 14.5 8.5 9.5 2 16"/><polyline points="16 6 22 6 22 12"/>' />,
  copy:     ({ size }) => <Icon size={size} d='<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' />,
  chevron:  ({ size }) => <Icon size={size} d='<polyline points="9 18 15 12 9 6"/>' />,
  arrow:    ({ size }) => <Icon size={size} d='<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>' />,
  settings: ({ size }) => <Icon size={size} d='<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' />,
  check:    ({ size }) => <Icon size={size} d='<polyline points="20 6 9 17 4 12"/>' />,
  link:     ({ size }) => <Icon size={size} d='<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' />,
  more:     ({ size }) => <Icon size={size} d='<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>' />,
  filter:   ({ size }) => <Icon size={size} d='<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>' />,
  receipt:  ({ size }) => <Icon size={size} d='<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>' />,
  card:     ({ size }) => <Icon size={size} d='<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' />,
};

window.I = I;
