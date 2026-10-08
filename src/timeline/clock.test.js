import { attachVideoClock } from './clock';
import { currentOffset } from '.';
import { mediaPosition, reducer, seek } from './playback';

const state = { currentRoute: { fullname: 'device|route', duration: 60000 }, offset: 0,
  desiredPlaySpeed: 1, startTime: 0, seekRevision: 0, loop: { startTime: 0, duration: 60000 } };

it('uses video time rather than wall time, including while stalled', () => {
  const detach = attachVideoClock('device|route', () => ({ offset: 1234, revision: 0 }));
  try {
    expect(currentOffset(state)).toBe(1234);
    expect(currentOffset({ ...state, isBufferingVideo: true })).toBe(1234);
  } finally { detach(); }
});

it('shows a pending seek and then follows the element after it applies the seek', () => {
  let sample = { offset: 1000, revision: 0 };
  const detach = attachVideoClock('device|route', () => sample);
  try {
    const sought = reducer({ ...state, isBufferingVideo: true }, seek(20000));
    expect(currentOffset(sought)).toBe(20000);
    sample = { offset: 20100, revision: 1 };
    expect(currentOffset(sought)).toBe(20100);
  } finally { detach(); }
});

it('clamps a zero-start clip without manufacturing a wrap ahead of the video', () => {
  const detach = attachVideoClock('device|route', () => ({ offset: 61000, revision: 0 }));
  try { expect(currentOffset(state)).toBe(60000); } finally { detach(); }
});

it('releasing an old player does not detach a newer player', () => {
  const old = attachVideoClock('device|route', () => ({ offset: 1, revision: 0 }));
  const next = attachVideoClock('device|route', () => ({ offset: 2, revision: 0 }));
  old();
  try { expect(currentOffset(state)).toBe(2); } finally { next(); }
});

it('rejects late media positions from another route', () => {
  expect(reducer(state, mediaPosition('old|route', 50000))).toBe(state);
});

it('preserves video position and releases buffering when switching to a map', () => {
  const released = reducer({ ...state, isBufferingVideo: true }, mediaPosition('device|route', 12000, true));
  expect(released).toMatchObject({ offset: 12000, isBufferingVideo: false, seekRevision: 0 });
});
