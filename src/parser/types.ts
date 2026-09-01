export type Command =
  | { kind: 'visit'; url: string }
  | { kind: 'viewport'; width: number; height: number }
  | { kind: 'click'; target: string }
  | { kind: 'type'; target: string; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'hover'; target: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { kind: 'scroll'; to: string }
  | { kind: 'wait'; ms?: number; target?: string; idle?: boolean }
  | { kind: 'zoom'; target: string }
  | { kind: 'resetZoom' }
  | { kind: 'highlight'; target: string }
  | { kind: 'caption'; text: string }
  | { kind: 'theme'; mode: 'light' | 'dark' }
  | { kind: 'output'; name: string; preset?: string };

export interface Script {
  commands: Command[];
}
