import * as Types from '../actions/types';
import { currentOffset } from '.';

export function reducer(state, action) {
  switch (action.type) {
    case Types.ACTION_SEEK: {
      if (!Number.isFinite(action.offset)) return state;
      const start = state.loop?.startTime ?? 0;
      const end = state.loop ? start + state.loop.duration : (state.currentRoute?.duration ?? Infinity);
      return { ...state, offset: Math.max(start, Math.min(end, action.offset)), startTime: Date.now(), seekRevision: (state.seekRevision || 0) + 1 };
    }
    case Types.ACTION_PAUSE:
      return { ...state, offset: currentOffset(state), startTime: Date.now(), desiredPlaySpeed: 0 };
    case Types.ACTION_PLAY:
      return action.speed === state.desiredPlaySpeed ? state
        : { ...state, offset: currentOffset(state), desiredPlaySpeed: action.speed, startTime: Date.now() };
    case Types.ACTION_LOOP:
      return { ...state, loop: action.start != null && action.end > action.start
        ? { startTime: action.start, duration: action.end - action.start } : null };
    case Types.ACTION_BUFFER_VIDEO:
      return { ...state, offset: currentOffset(state), startTime: Date.now(), isBufferingVideo: action.buffering };
    case Types.ACTION_MEDIA_POSITION:
      return action.route === state.currentRoute?.fullname && Number.isFinite(action.offset)
        ? { ...state, offset: action.offset, startTime: Date.now(), isBufferingVideo: action.release ? false : state.isBufferingVideo } : state;
    case Types.ACTION_RESET:
      return { ...state, desiredPlaySpeed: 1, isBufferingVideo: true, offset: state.zoom?.start ?? 0,
        startTime: Date.now(), seekRevision: (state.seekRevision || 0) + 1 };
    default:
      return state;
  }
}

export const seek = (offset) => ({ type: Types.ACTION_SEEK, offset });
export const pause = () => ({ type: Types.ACTION_PAUSE });
export const play = (speed = 1) => ({ type: Types.ACTION_PLAY, speed });
export const selectLoop = (start, end) => ({ type: Types.ACTION_LOOP, start, end });
export const bufferVideo = (buffering) => ({ type: Types.ACTION_BUFFER_VIDEO, buffering });
export const resetPlayback = () => ({ type: Types.ACTION_RESET });
export const mediaPosition = (route, offset, release = false) => ({ type: Types.ACTION_MEDIA_POSITION, route, offset, release });
