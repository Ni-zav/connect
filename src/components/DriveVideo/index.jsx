import React, { Component } from 'react';
import { connect } from 'react-redux';
import { CircularProgress, Typography } from '@material-ui/core';
import Hls from 'hls.js/light';

import { api } from '../../api/backend';
import Colors from '../../colors';
import { ErrorOutline } from '../../icons';
import { currentOffset } from '../../timeline';
import { attachVideoClock } from '../../timeline/clock';
import { bufferVideo, mediaPosition, pause, play } from '../../timeline/playback';
import { isFirefox } from '../../utils/browser';

export class DriveVideo extends Component {
  video = React.createRef();
  state = { error: null, needsPlay: false };
  generation = 0;
  initialized = false;
  started = false;
  disposed = false;

  componentDidMount() {
    this.pendingOffset = currentOffset(this.props);
    this.detachClock = attachVideoClock(this.props.currentRoute.fullname, () => this.initialized
      ? { offset: this.routeOffset(), revision: this.appliedRevision } : null);
    this.loadSource();
  }

  componentDidUpdate(previous) {
    if (previous.seekRevision !== this.props.seekRevision) this.seekTo(this.props.offset);
    if (previous.loop !== this.props.loop) {
      const { start, end } = this.bounds();
      const offset = this.routeOffset();
      if (offset < start || offset >= end) this.seekTo(start);
    }
    if (previous.desiredPlaySpeed !== this.props.desiredPlaySpeed || previous.isMuted !== this.props.isMuted) this.applyPlayback();
  }

  componentWillUnmount() {
    const offset = this.initialized ? this.routeOffset() : this.pendingOffset;
    this.disposed = true;
    this.generation += 1;
    this.stopFrames();
    this.detachClock();
    this.hls?.destroy();
    this.props.dispatch(mediaPosition(this.props.currentRoute.fullname, offset, true));
  }

  routeOffset = () => this.video.current.currentTime * 1000 + (this.props.currentRoute.videoStartOffset || 0);

  bounds = () => {
    const { currentRoute, loop } = this.props;
    const start = Math.max(loop?.startTime ?? 0, currentRoute.videoStartOffset || 0);
    const duration = this.video.current?.duration;
    const videoEnd = Number.isFinite(duration) ? duration * 1000 + (currentRoute.videoStartOffset || 0) : Infinity;
    return { start, end: Math.min(loop ? loop.startTime + loop.duration : currentRoute.duration, videoEnd) };
  };

  loadSource = () => {
    const video = this.video.current;
    this.generation += 1;
    const generation = this.generation;
    if (this.initialized) this.pendingOffset = this.routeOffset();
    this.started = false;
    this.failed = false;
    this.hls?.destroy();
    this.hls = null;
    this.stopFrames();
    this.initialized = false;
    this.setState({ error: null, needsPlay: false });
    this.props.dispatch(bufferVideo(true));
    this.hasAudio = false;
    this.props.onAudioStatusChange?.(false);
    const route = this.props.currentRoute;
    const source = api.video.getQcameraStreamUrl(route.fullname, route.share_exp, route.share_sig);
    if (!source) return this.fail('Video is not available for this drive.');
    // Safari (including installed iOS PWAs) plays HLS natively, preserving its
    // audio and autoplay behavior. Other browsers use the bundled HLS engine.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      video.load();
    } else if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 40, startPosition: Math.max(0, (this.pendingOffset - (route.videoStartOffset || 0)) / 1000) });
      this.hls = hls;
      hls.on(Hls.Events.BUFFER_CODECS, (_event, data) => {
        if (generation === this.generation && !this.disposed) this.reportAudio(Boolean(data.audio || data.tracks?.audio));
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (generation !== this.generation || this.disposed || !data.fatal) return;
        this.fail(data.response?.code === 404
          ? 'This video segment has not uploaded yet or has been deleted.'
          : 'Unable to load video. Check your connection and try again.');
      });
      hls.loadSource(source);
      hls.attachMedia(video);
    } else {
      this.fail('This browser cannot play this video.');
    }
  };

  seekTo = (offset) => {
    this.pendingOffset = offset;
    const video = this.video.current;
    if (!video || video.readyState < 1 || !Number.isFinite(offset)) return;
    const { start, end } = this.bounds();
    if (end <= start) return this.fail('No video is available in this selection.');
    const target = Math.max(start, Math.min(end, offset));
    video.currentTime = Math.max(0, (target - (this.props.currentRoute.videoStartOffset || 0)) / 1000);
    this.appliedRevision = this.props.seekRevision || 0;
    this.initialized = true;
  };

  reportAudio = (present) => {
    if (present && !this.hasAudio) {
      this.hasAudio = true;
      this.props.onAudioStatusChange?.(true);
    }
  };

  reportNativeAudio = () => {
    const video = this.video.current;
    if (!this.hls) this.reportAudio(Boolean(video.audioTracks?.length || video.mozHasAudio || video.webkitAudioDecodedByteCount));
  };

  onMetadata = () => {
    this.seekTo(this.pendingOffset);
    this.reportNativeAudio();
    this.applyPlayback();
  };

  applyPlayback = () => {
    const video = this.video.current;
    const speed = this.props.desiredPlaySpeed;
    if (!video || this.failed) return;
    if (!speed) return video.pause();
    const rate = Math.min(speed, isFirefox() && !this.props.isMuted ? 8 : 16);
    try { video.playbackRate = rate; } catch { video.playbackRate = 1; }
    if (video.playbackRate !== speed) this.props.dispatch(play(video.playbackRate));
    if (!video.paused) return;
    const generation = this.generation;
    video.play()?.catch((error) => {
      if (this.disposed || generation !== this.generation || !this.props.desiredPlaySpeed || error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        this.setState({ needsPlay: true });
        this.props.dispatch(pause());
      } else {
        this.fail('Unable to play video. Try again.');
      }
    });
  };

  fail = (error) => {
    this.failed = true;
    this.started = false;
    this.video.current?.pause();
    this.setState({ error });
    this.props.dispatch(bufferVideo(true));
    this.stopFrames();
  };

  onProgress = () => {
    if (!this.initialized || this.state.error) return;
    this.reportNativeAudio();
    const { start, end } = this.bounds();
    if (this.routeOffset() >= end && this.props.desiredPlaySpeed) {
      this.seekTo(start);
      this.applyPlayback();
    }
    this.props.dispatch(mediaPosition(this.props.currentRoute.fullname, this.routeOffset()));
  };

  // Check clip boundaries per displayed frame; timeupdate also covers browsers
  // without video frame callbacks and background/foreground transitions.
  onFrame = () => {
    this.frame = null;
    const video = this.video.current;
    if (!video || video.paused || this.disposed || this.state.error) return;
    const { start, end } = this.bounds();
    if (this.routeOffset() >= end) this.seekTo(start);
    this.frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(this.onFrame) : requestAnimationFrame(this.onFrame);
  };

  stopFrames = () => {
    if (this.frame != null) {
      if (this.video.current?.cancelVideoFrameCallback) this.video.current.cancelVideoFrameCallback(this.frame);
      else cancelAnimationFrame(this.frame);
    }
    this.frame = null;
  };

  onPlaying = () => {
    this.started = true;
    if (!this.props.desiredPlaySpeed) this.props.dispatch(play(this.video.current.playbackRate || 1));
    this.setState({ needsPlay: false });
    this.props.dispatch(bufferVideo(false));
    this.stopFrames();
    this.onFrame();
  };

  onPause = () => {
    this.stopFrames();
    if (this.started && !this.disposed && this.props.desiredPlaySpeed && !this.video.current.seeking && !this.video.current.ended) this.props.dispatch(pause());
  };

  resume = () => {
    this.setState({ needsPlay: false });
    this.props.dispatch(play());
    const generation = this.generation;
    this.video.current.play()?.catch((error) => {
      if (error.name !== 'AbortError' && !this.disposed && generation === this.generation && this.props.desiredPlaySpeed) {
        this.setState({ needsPlay: true });
        this.props.dispatch(pause());
      }
    });
  };

  render() {
    const { isMuted, isBufferingVideo } = this.props;
    const { error, needsPlay } = this.state;
    return (
      <div className="min-h-[200px] relative max-w-[964px] m-[0_auto] aspect-[1.593]">
        <video ref={this.video} playsInline muted={isMuted} preload="auto" aria-label="Drive video"
          className="w-full h-full" onLoadedMetadata={this.onMetadata} onDurationChange={this.onProgress}
          onRateChange={() => { if (this.props.desiredPlaySpeed && this.props.desiredPlaySpeed !== this.video.current.playbackRate) this.props.dispatch(play(this.video.current.playbackRate)); }}
          onTimeUpdate={this.onProgress} onEnded={this.onProgress} onPlaying={this.onPlaying} onPause={this.onPause}
          onCanPlay={() => { this.reportNativeAudio(); this.props.dispatch(bufferVideo(false)); }}
          onWaiting={() => this.props.dispatch(bufferVideo(true))}
          onSeeking={() => this.props.dispatch(bufferVideo(true))}
          onSeeked={() => { this.onProgress(); if (this.video.current.readyState >= 2) this.props.dispatch(bufferVideo(false)); }}
          onError={() => { if (this.video.current.error) this.fail('Unable to load video. Check your connection and try again.'); }} />
        {(error || needsPlay || isBufferingVideo) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#16181AAA]" role="status" aria-live="polite">
            {error ? <><ErrorOutline /><Typography>{error}</Typography><button className="rounded-full bg-white px-5 py-2 text-black" onClick={this.loadSource}>Try again</button></>
              : needsPlay ? <button className="rounded-full bg-white px-5 py-2 text-black" onClick={this.resume}>Play video</button>
              : <CircularProgress style={{ color: Colors.white }} thickness={4} size={50} />}
          </div>
        )}
      </div>
    );
  }
}

const stateToProps = (state) => ({
  startTime: state.startTime, desiredPlaySpeed: state.desiredPlaySpeed, offset: state.offset, seekRevision: state.seekRevision,
  isBufferingVideo: state.isBufferingVideo, currentRoute: state.currentRoute, loop: state.loop,
});

const RouteVideo = (props) => props.currentRoute
  ? <DriveVideo key={`${props.currentRoute.fullname}|${props.currentRoute.share_exp}|${props.currentRoute.share_sig}`} {...props} />
  : null;

export default connect(stateToProps)(RouteVideo);
