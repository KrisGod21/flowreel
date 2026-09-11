export type Command =
  | { kind: 'visit'; url: string }
  | { kind: 'viewport'; width: number; height: number }
  | { kind: 'click'; target: string }
  | { kind: 'type'; target: string; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'hover'; target: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { kind: 'scroll'; to: string }
  // Three genuinely different commands that share a keyword, so they are three
  // members rather than one bag of optional fields - `{ kind: 'wait' }` with
  // nothing set is not a thing the parser can produce and should not typecheck.
  | { kind: 'wait'; ms: number }
  | { kind: 'wait'; target: string }
  | { kind: 'wait'; idle: true }
  | { kind: 'zoom'; target: string }
  | { kind: 'resetZoom' }
  | { kind: 'highlight'; target: string }
  | { kind: 'resetHighlight' }
  | { kind: 'caption'; text: string }
  | { kind: 'theme'; mode: 'light' | 'dark' }
  | { kind: 'frame'; style: 'window' | 'none' }
  | { kind: 'output'; name: string; preset?: string };

export interface Script {
  commands: Command[];
}
