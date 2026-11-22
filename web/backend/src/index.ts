// Haven knowledge layer: coping cards + retrieval (RAG), crisis rules, hotline data.
// Pure TypeScript: no server, no network, no Firebase. Runs in the browser.
export type {
  CopingCard,
  CopingCardSource,
  HotlineData,
  CountryHotlines,
  HotlineEntry,
  HotlineSource,
} from "./types";
export {
  DEFAULT_MODE,
  INITIAL_LISTEN_STATE,
  GAP_HOURS,
  MIN_MEMORY_MESSAGE_WORDS,
  OFFER_AFTER_LISTEN_TURNS,
  SUMMARY_LABELS,
  cardWasTried,
  detectHelpIntent,
  gapLabel,
  isChatMode,
  nextListenState,
  parseSummary,
  resolveMode,
  shouldAskQuestion,
  shouldOfferIdeas,
  vetMemory,
} from "./chatStyle";
export type { ChatMode, ListenState, ParsedSummary } from "./chatStyle";
export { PLAN_IDEAS, SITUATIONS, detectSituations, matchPlanIdeas } from "./planIdeas";
export type { PlanIdea, Situation, SituationScore } from "./planIdeas";
export {
  READING_LINKS,
  MAX_READING,
  isHttpsUrl,
  readingFor,
  readingForIdeas,
  resolveReading,
} from "./readingLinks";
export type { ReadingLink } from "./readingLinks";
export { COPING_CARDS, retrieve, scoreCard, tokenize } from "./retrieval";
export type { ScoredCard } from "./retrieval";
export { detectCrisis, isCrisis, normalizeForCrisis } from "./crisis";
export type { CrisisResult } from "./crisis";
export { LOCAL_HOTLINES, isPlaceholder, parseHotlines, matchCountry, telNumber } from "./hotlines";
export {
  ENTITY_KINDS,
  detectWithRegex,
  dedupeEntities,
  applyMasks,
  holdBackPartial,
  unmask,
  unmaskPartial,
} from "./shield";
export type { Entity, EntityKind, Segment, MaskResult, UnmaskResult } from "./shield";
export {
  BACKUP_VERSION,
  MAX_JOURNAL_TEXT,
  MAX_SETTING,
  NOTE_COLORS,
  buildBackup,
  isNoteColor,
  isRealDay,
  validateBackup,
} from "./backup";
export type {
  HavenBackup,
  BackupMessage,
  BackupSummary,
  BackupFact,
  BackupJournal,
  NoteColor,
  ValidationResult,
} from "./backup";
