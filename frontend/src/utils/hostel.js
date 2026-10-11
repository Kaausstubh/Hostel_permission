export const HOSTEL_NAME_MAP = {
  BH1: 'Brahmaputra (BH1)',
  BH2: 'Krishna (BH2)',
  GH1: 'Indrayani (GH1)',
  GH2: 'Sindhu (GH2)',
  GH: 'Indrayani (GH1)', // legacy backwards-compatibility alias
};

export const HOSTEL_OPTIONS = [
  { value: 'BH1', label: 'Brahmaputra (BH1)' },
  { value: 'BH2', label: 'Krishna (BH2)' },
  { value: 'GH1', label: 'Indrayani (GH1)' },
  { value: 'GH2', label: 'Sindhu (GH2)' },
];

/**
 * Returns formatted hostel name e.g. "Brahmaputra (BH1)" for "BH1".
 * If not recognized or empty, returns fallback.
 */
export const getHostelLabel = (code, fallback = '—') => {
  if (!code) return fallback;
  return HOSTEL_NAME_MAP[code] || code;
};
