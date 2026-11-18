export interface CopingCardSource {
  name: string;
  url: string;
}

export interface CopingCard {
  id: string;
  title: string;
  tags: string[];
  text: string;
  source: CopingCardSource;
  /** Written by Claude, not yet verified by a human. Only a person may set this to true. */
  reviewed: boolean;
  /**
   * Date (YYYY-MM-DD) when a credible page was opened and its advice compared with this card.
   * Not human or clinical review: `reviewed` stays false. Absent when no source could be verified.
   */
  sourceChecked?: string;
}

export interface HotlineEntry {
  name: string;
  phone?: string;
  text?: string;
  url?: string;
  notes?: string;
  /** Where this entry came from (for attribution). */
  source?: string;
}

export interface CountryHotlines {
  code: string;
  name: string;
  emergency: string;
  /** Other names a user might type for this place (e.g. "uk" for GB). */
  aliases?: string[];
  lines: HotlineEntry[];
}

export interface HotlineSource {
  name: string;
  url: string;
  license?: string;
  retrievedAt?: string;
}

export interface HotlineData {
  version: number;
  note?: string;
  /** ISO date the data was last scraped. */
  retrievedAt?: string;
  sources?: HotlineSource[];
  /** International directory shown for places not in the list. */
  directoryUrl?: string;
  countries: CountryHotlines[];
}
