export const HOSTEL_NAME_MAP = {
  BH1: 'Brahmaputra (BH1)',
  BH2: 'Krishna (BH2)',
  GH: 'Indrayani (GH)',
};

export const HOSTEL_OPTIONS = [
  { value: 'BH1', label: 'Brahmaputra (BH1)' },
  { value: 'BH2', label: 'Krishna (BH2)' },
  { value: 'GH', label: 'Indrayani (GH)' },
];

/**
 * Returns formatted hostel name e.g. "Brahmaputra (BH1)" for "BH1".
 * If not recognized or empty, returns fallback.
 */
export const getHostelLabel = (code, fallback = '—') => {
  if (!code) return fallback;
  return HOSTEL_NAME_MAP[code] || code;
};
