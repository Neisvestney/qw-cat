import {MutableRefObject, useEffect, useRef} from "react";
import {autorun} from "mobx";

const HARD_SYNC_THRESHOLD = 0.15;
const SOFT_SYNC_THRESHOLD = 0.01;
// <audio> seeks themselves land tens of ms off, so smaller drift is left to rate correction
const FORCED_SEEK_THRESHOLD = 0.05;
const MAX_RATE_CORRECTION = 0.03;
const SYNC_INTERVAL_MS = 250;
const GAIN_SMOOTHING = 0.015;

export function gainToGainValue(v: number) {
  return v / 100;
}

export interface MixerTrack {
  streamIndex: number;
  url: string | undefined;
  gain: number;
}

export interface MixerState {
  volume: number;
  defaultGain: number;
  tracks: MixerTrack[];
}

interface VideoGraph {
  ctx: AudioContext;
  master: GainNode;
  defaultGain: GainNode;
}

interface TrackNode {
  url: string;
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  enabled: boolean;
  listeners: AbortController;
}

// createMediaElementSource can only be called once per element, so the graph must survive StrictMode re-runs
const videoGraphs = new WeakMap<HTMLVideoElement, VideoGraph>();

function getVideoGraph(video: HTMLVideoElement) {
  let graph = videoGraphs.get(video);
  if (!graph) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    const defaultGain = ctx.createGain();
    ctx.createMediaElementSource(video).connect(defaultGain).connect(master).connect(ctx.destination);
    graph = {ctx, master, defaultGain};
    videoGraphs.set(video, graph);
  }
  return graph;
}

function setGain(ctx: AudioContext, node: GainNode, value: number) {
  // a suspended context's clock is frozen, so scheduled ramps would only start (from 1.0) after resume
  if (ctx.state !== "running") {
    node.gain.cancelScheduledValues(0);
    node.gain.value = value;
    return;
  }
  node.gain.setTargetAtTime(value, ctx.currentTime, GAIN_SMOOTHING);
}

function syncTrack(video: HTMLVideoElement, track: TrackNode, hard: boolean) {
  const {audio} = track;

  if (video.paused || video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || !track.enabled) {
    if (!audio.paused) audio.pause();
    return;
  }

  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

  if (video.currentTime >= audio.duration) {
    if (!audio.paused) audio.pause();
    return;
  }

  // a buffering track would drift further on every tick and get re-seeked before it ever fills up
  if (!hard && (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)) return;

  const diff = audio.currentTime - video.currentTime;
  const absDiff = Math.abs(diff);
  if (absDiff > HARD_SYNC_THRESHOLD || ((hard || audio.paused) && absDiff > FORCED_SEEK_THRESHOLD)) {
    audio.currentTime = video.currentTime;
    audio.playbackRate = video.playbackRate;
  } else if (absDiff > SOFT_SYNC_THRESHOLD) {
    // drift in seconds is used directly as a rate fraction: 20ms ahead -> play 2% slower
    const correction = Math.max(-MAX_RATE_CORRECTION, Math.min(MAX_RATE_CORRECTION, diff));
    audio.playbackRate = video.playbackRate * (1 - correction);
  } else {
    audio.playbackRate = video.playbackRate;
  }

  if (audio.paused) audio.play().catch(() => undefined);
}

export function useAudioMixer(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  getState: () => MixerState | null,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const getStateRef = useRef(getState);
  useEffect(() => {
    getStateRef.current = getState;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const graph = getVideoGraph(video);
    const {ctx, master} = graph;
    ctxRef.current = ctx;

    const tracks = new Map<number, TrackNode>();

    const syncAll = (hard: boolean) => tracks.forEach((track) => syncTrack(video, track, hard));

    const createTrack = (url: string, initialGain: number) => {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.src = url;

      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      gain.gain.value = initialGain;
      source.connect(gain).connect(master);

      const listeners = new AbortController();
      const track: TrackNode = {url, audio, source, gain, enabled: false, listeners};
      const onReady = () => syncTrack(video, track, false);
      audio.addEventListener("loadedmetadata", onReady, {signal: listeners.signal});
      audio.addEventListener("canplay", onReady, {signal: listeners.signal});
      return track;
    };

    const destroyTrack = (track: TrackNode) => {
      track.listeners.abort();
      track.audio.pause();
      track.audio.removeAttribute("src");
      track.audio.load();
      track.source.disconnect();
      track.gain.disconnect();
    };

    const disposeAutorun = autorun(() => {
      const state = getStateRef.current();

      setGain(ctx, master, state?.volume ?? 0);
      setGain(ctx, graph.defaultGain, state?.defaultGain ?? 0);

      const seen = new Set<number>();
      for (const {streamIndex, url, gain} of state?.tracks ?? []) {
        if (!url) continue;
        seen.add(streamIndex);

        let track = tracks.get(streamIndex);
        if (track && track.url !== url) {
          destroyTrack(track);
          track = undefined;
        }
        if (!track) {
          track = createTrack(url, gain);
          tracks.set(streamIndex, track);
        }

        setGain(ctx, track.gain, gain);
        const enabled = gain > 0;
        if (enabled !== track.enabled) {
          track.enabled = enabled;
          syncTrack(video, track, true);
        }
      }

      tracks.forEach((track, streamIndex) => {
        if (!seen.has(streamIndex)) {
          destroyTrack(track);
          tracks.delete(streamIndex);
        }
      });
    });

    const handlePlay = () => {
      ctx.resume().catch(() => undefined);
      syncAll(true);
    };
    const handleHardSync = () => syncAll(true);
    const handleSoftSync = () => syncAll(false);

    video.addEventListener("play", handlePlay);
    video.addEventListener("playing", handleHardSync);
    video.addEventListener("seeked", handleHardSync);
    video.addEventListener("pause", handleSoftSync);
    video.addEventListener("seeking", handleSoftSync);
    video.addEventListener("waiting", handleSoftSync);
    video.addEventListener("ratechange", handleSoftSync);

    const interval = setInterval(() => {
      if (!video.paused) syncAll(false);
    }, SYNC_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      disposeAutorun();

      video.removeEventListener("play", handlePlay);
      video.removeEventListener("playing", handleHardSync);
      video.removeEventListener("seeked", handleHardSync);
      video.removeEventListener("pause", handleSoftSync);
      video.removeEventListener("seeking", handleSoftSync);
      video.removeEventListener("waiting", handleSoftSync);
      video.removeEventListener("ratechange", handleSoftSync);

      tracks.forEach(destroyTrack);
      tracks.clear();

      // StrictMode's simulated unmount keeps the element in the DOM; a real unmount detaches it first
      if (!video.isConnected) {
        ctx.close().catch(() => undefined);
        videoGraphs.delete(video);
        ctxRef.current = null;
      }
    };
  }, [videoRef]);

  return ctxRef;
}
