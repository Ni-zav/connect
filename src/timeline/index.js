import store from '../store';
import { readVideoClock } from './clock';

export function currentOffset(state = null) {
  state ||= store.getState();
  const videoOffset = readVideoClock(state);
  const speed = state.isBufferingVideo ? 0 : state.desiredPlaySpeed;
  let offset = videoOffset ?? ((state.offset ?? state.loop?.startTime ?? 0) + (Date.now() - state.startTime) * speed);
  const loop = state.loop;
  if (loop && loop.startTime != null && loop.duration > 0) {
    const end = loop.startTime + loop.duration;
    if (offset < loop.startTime) offset = loop.startTime;
    if (offset > end) offset = videoOffset != null ? end : (offset - loop.startTime) % loop.duration + loop.startTime;
  }
  return offset;
}
