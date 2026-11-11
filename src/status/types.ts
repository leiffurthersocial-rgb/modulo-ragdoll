export type StatusId =
  | 'burning'
  | 'frozen'
  | 'shocked'
  | 'soaked'
  | 'oiled'
  | 'poisoned'
  | 'acid'
  | 'floating'
  | 'slowed'
  | 'crushed'
  | 'heavy'
  | 'stopped';

export interface StatusInstance {
  /** Seconds remaining. */
  time: number;
  /** Stack count (capped per status). */
  stacks: number;
}

export type StatusMap = Map<StatusId, StatusInstance>;
