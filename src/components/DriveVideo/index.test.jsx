import React from 'react';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Hls from 'hls.js/light';

import DriveVideo from '.';
import { bufferVideo, play, pause, reducer, seek } from '../../timeline/playback';
import { currentOffset } from '../../timeline';

const mocks = vi.hoisted(() => ({ instances: [], supported: true }));
vi.mock('hls.js/light', () => ({ default: class {
  static isSupported = () => mocks.supported;
  static Events = { BUFFER_CODECS: 'codecs', ERROR: 'error' };
  audioTracks = [];
  handlers = {};
  constructor(options) { this.options = options; mocks.instances.push(this); }
  on = (event, fn) => { this.handlers[event] = fn; };
  loadSource = vi.fn(); attachMedia = vi.fn(); destroy = vi.fn();
} }));
vi.mock('../../api/backend', () => ({ api: { video: { getQcameraStreamUrl: () => 'https://example.com/drive.m3u8' } } }));

let media;
beforeEach(() => {
  vi.clearAllMocks();
  media = { time: 0, duration: 60, ready: 0, paused: true, ended: false, seeks: 0, audio: [], native: true };
  mocks.instances = [];
  mocks.supported = true;
  for (const [name, get, set] of [
    ['currentTime', () => media.time, (value) => { media.time = value; media.seeks += 1; }],
    ['duration', () => media.duration], ['readyState', () => media.ready], ['paused', () => media.paused],
    ['webkitAudioDecodedByteCount', () => media.bytes || 0], ['ended', () => media.ended], ['audioTracks', () => media.audio], ['error', () => null],
  ]) Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, get, set });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { media.paused = true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { media.paused = false; return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(() => media.native ? 'probably' : '');
});

function setup(overrides = {}) {
  const store = createStore(reducer, { currentRoute: { fullname: 'device|route', duration: 60000, videoStartOffset: 0 },
    loop: { startTime: 0, duration: 60000 }, offset: 10000, seekRevision: 0, startTime: Date.now(),
    desiredPlaySpeed: 1, isBufferingVideo: true, ...overrides });
  const audio = vi.fn();
  const view = render(<Provider store={store}><DriveVideo isMuted onAudioStatusChange={audio} /></Provider>);
  const video = screen.getByLabelText('Drive video');
  const ready = () => { media.ready = 4; fireEvent.loadedMetadata(video); fireEvent.canPlay(video); };
  return { ...view, store, video, ready, audio };
}

it('uses native HLS on Safari without loading a second engine', () => {
  const { video, ready } = setup();
  expect(video).toHaveAttribute('playsinline');
  expect(video).toHaveAttribute('src', 'https://example.com/drive.m3u8');
  ready();
  expect(media.time).toBe(10);
  expect(mocks.instances).toHaveLength(0);
});

it('seeks only for commands and keeps map time pinned to the actual video', () => {
  const { store, ready, video } = setup();
  ready();
  const seeks = media.seeks;
  media.time = 12.345;
  fireEvent.timeUpdate(video);
  act(() => store.dispatch(play(2)));
  act(() => store.dispatch(bufferVideo(true)));
  act(() => store.dispatch(bufferVideo(false)));
  expect(media.seeks).toBe(seeks);
  expect(currentOffset(store.getState())).toBe(12345);
  act(() => store.dispatch(seek(20000)));
  expect(media.time).toBe(20);
});

it('a seek requested before metadata is retained until the video is ready', () => {
  const { store, ready } = setup();
  act(() => store.dispatch(seek(25000)));
  expect(media.seeks).toBe(0);
  ready();
  expect(media.time).toBe(25);
});

it('a paused video can seek and finish loading without being played', () => {
  const { store, ready, video } = setup({ desiredPlaySpeed: 0 });
  ready();
  act(() => store.dispatch(seek(20000)));
  fireEvent.seeked(video);
  expect(store.getState().isBufferingVideo).toBe(false);
  expect(media.time).toBe(20);
  expect(video.play).not.toHaveBeenCalled();
});

it('loops a zero-start selection and resumes when the media ends', () => {
  const { ready, video } = setup();
  ready();
  media.time = 60;
  media.ended = true;
  media.paused = true;
  fireEvent.pause(video);
  fireEvent.ended(video);
  expect(media.time).toBe(0);
  expect(media.paused).toBe(false);
});

it('accounts for the first camera frame offset when mapping route and media time', () => {
  const { ready, store } = setup({ currentRoute: { fullname: 'device|route', duration: 60000, videoStartOffset: 2000 } });
  ready();
  expect(media.time).toBe(8);
  media.time = 9;
  expect(currentOffset(store.getState())).toBe(11000);
});

it('reports a browser pause back to the controls', () => {
  const { ready, video, store } = setup();
  ready();
  fireEvent.playing(video);
  media.paused = true;
  fireEvent.pause(video);
  expect(store.getState().desiredPlaySpeed).toBe(0);
});

it('offers a user-gesture play button after autoplay is denied', async () => {
  HTMLMediaElement.prototype.play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  const { ready, store } = setup();
  ready();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Play video' })).toBeVisible());
  expect(store.getState().desiredPlaySpeed).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  expect(media.paused).toBe(false);
});

it('loads bundled HLS, reports audio, and exposes a retry for fatal 404 errors', () => {
  media.native = false;
  const { audio, ready } = setup();
  const hls = mocks.instances[0];
  expect(hls.options.startPosition).toBe(10);
  act(() => hls.handlers[Hls.Events.BUFFER_CODECS]('codecs', { audio: {} }));
  ready();
  expect(audio).toHaveBeenLastCalledWith(true);
  act(() => hls.handlers[Hls.Events.ERROR]('error', { fatal: true, response: { code: 404 } }));
  expect(screen.getByText('This video segment has not uploaded yet or has been deleted.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(hls.destroy).toHaveBeenCalledOnce();
  expect(mocks.instances).toHaveLength(2);
});

it('ignores nonfatal HLS errors and cleans up the player and clock on unmount', () => {
  media.native = false;
  const { store, ready, unmount } = setup();
  ready();
  const hls = mocks.instances[0];
  act(() => hls.handlers[Hls.Events.ERROR]('error', { fatal: false }));
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  media.time = 15;
  unmount();
  expect(hls.destroy).toHaveBeenCalledOnce();
  expect(store.getState()).toMatchObject({ offset: 15000, isBufferingVideo: false });
});

it('ignores a late autoplay rejection after the user has paused', async () => {
  let reject;
  HTMLMediaElement.prototype.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { ready, store } = setup();
  ready();
  act(() => store.dispatch(pause()));
  await act(async () => reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })));
  expect(media.paused).toBe(true);
  expect(screen.queryByRole('button', { name: 'Play video' })).not.toBeInTheDocument();
});

it('reflects browser-initiated playback in the controls', () => {
  const { ready, video, store } = setup({ desiredPlaySpeed: 0 });
  ready();
  media.paused = false;
  fireEvent.playing(video);
  expect(store.getState().desiredPlaySpeed).toBe(1);
});


it('detects native Chromium audio once decoding begins even without AudioTrackList', () => {
  const { ready, audio, video } = setup();
  ready();
  media.bytes = 100;
  fireEvent.timeUpdate(video);
  expect(audio).toHaveBeenLastCalledWith(true);
});
