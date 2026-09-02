export interface Frame {
  data: Buffer;
  timestampMs: number;
}

export interface FrameSet {
  frames: Frame[];
  width: number;
  height: number;
}
