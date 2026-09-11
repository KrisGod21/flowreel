export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One thing the user did, as captured by the injected recorder or Node. `at` is ms since recording started. */
export type InteractionEvent =
  | { type: 'navigate'; url: string; title: string; at: number }
  | { type: 'click'; target: string; label: string; box: Box; at: number }
  | { type: 'input'; target: string; value: string; box: Box; at: number }
  | { type: 'press'; key: string; at: number }
  | { type: 'scroll'; deltaY: number; at: number };

export interface RecordedSession {
  events: InteractionEvent[];
  viewport: { width: number; height: number };
}
