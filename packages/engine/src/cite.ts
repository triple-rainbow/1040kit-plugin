import type { Citation } from './types.ts';

/** Canonical URLs for the IRS documents the engine cites (KB doc ids). */
export const DOC_URLS = {
  i1040gi: 'https://www.irs.gov/instructions/i1040gi',
  f1040: 'https://www.irs.gov/forms-pubs/about-form-1040',
  i1040sc: 'https://www.irs.gov/instructions/i1040sc',
  i1040sse: 'https://www.irs.gov/instructions/i1040sse',
  i1040s8: 'https://www.irs.gov/instructions/i1040s8',
  i8995: 'https://www.irs.gov/instructions/i8995',
  f1040s1a: 'https://www.irs.gov/forms-pubs/about-schedule-1-a-form-1040',
  i1040sb: 'https://www.irs.gov/instructions/i1040sb',
  p501: 'https://www.irs.gov/publications/p501',
  p560: 'https://www.irs.gov/publications/p560',
  p587: 'https://www.irs.gov/publications/p587',
  p463: 'https://www.irs.gov/publications/p463',
  p334: 'https://www.irs.gov/publications/p334',
  p596: 'https://www.irs.gov/publications/p596',
  i1040sca: 'https://www.irs.gov/instructions/i1040sca',
  i8959: 'https://www.irs.gov/instructions/i8959',
  i8960: 'https://www.irs.gov/instructions/i8960',
  i8829: 'https://www.irs.gov/instructions/i8829',
  iw2: 'https://www.irs.gov/instructions/iw2w3',
  i1040se: 'https://www.irs.gov/instructions/i1040se',
  f1040se: 'https://www.irs.gov/forms-pubs/about-schedule-e-form-1040',
  f1040sei: 'https://www.irs.gov/forms-pubs/about-schedule-eic-form-1040',
  f8959: 'https://www.irs.gov/forms-pubs/about-form-8959',
  f8960: 'https://www.irs.gov/forms-pubs/about-form-8960',
  f8829: 'https://www.irs.gov/forms-pubs/about-form-8829',
  i8582: 'https://www.irs.gov/instructions/i8582',
  i8862: 'https://www.irs.gov/instructions/i8862',
  p527: 'https://www.irs.gov/publications/p527',
  p925: 'https://www.irs.gov/publications/p925',
  p946: 'https://www.irs.gov/publications/p946',
  p970: 'https://www.irs.gov/publications/p970',
  p1040: 'https://www.irs.gov/pub/irs-pdf/p1040.pdf',
  i1098e: 'https://www.irs.gov/instructions/i1098et',
  i1099k: 'https://www.irs.gov/forms-pubs/about-form-1099-k',
  rp202440: 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf',
  rp202532: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
  pl11921: 'https://www.congress.gov/bill/119th-congress/house-bill/1/text',
} as const;

export type DocId = keyof typeof DOC_URLS;

export function cite(docId: DocId, section?: string): Citation {
  return section === undefined
    ? { docId, url: DOC_URLS[docId] }
    : { docId, section, url: DOC_URLS[docId] };
}
