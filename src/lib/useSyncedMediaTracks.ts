import {MutableRefObject, useCallback, useEffect, useRef, useState} from "react";

export function useSyncedMediaTracks(
  audioUrls: string[],
  audionStreamsCount: number,
  gains: number[],
  videoRef: MutableRefObject<HTMLVideoElement | null>,
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const gainNodesRef = useRef<Map<number, GainNode>>(new Map());
  const sourcesRef = useRef<Map<number, AudioBufferSourceNode>>(new Map());
  const pendingPlayRef = useRef(false);
  const readyCountsRef = useRef({loaded: 0, total: audionStreamsCount});
  const abortRef = useRef<AbortController | null>(null);

  const stopSource = (idx: number) => {
    const source = sourcesRef.current.get(idx);
    if (source) {
      source.stop();
      sourcesRef.current.delete(idx);
    }
  };

  const startSourceAt = useCallback((trackIdx: number, time: number) => {
    const ctx = ctxRef.current;
    const buffer = buffersRef.current.get(trackIdx);
    const gainNode = gainNodesRef.current.get(trackIdx);

    if (!ctx || !buffer || !gainNode) return;

    stopSource(trackIdx);

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const offset = Math.min(time, buffer.duration);
    node.connect(gainNode).connect(ctx.destination);
    node.start(0, offset);
    sourcesRef.current.set(trackIdx, node);
  }, []);

  const startAllAt = useCallback(
    (time: number) => {
      if (!ctxRef.current) return;
      if (videoRef.current?.paused) return;
      buffersRef.current.forEach((_, idx) => startSourceAt(idx, time));
    },
    [startSourceAt, videoRef],
  );

  const [initialGains] = useState(gains);

  // initialize context + load audio buffers
  useEffect(() => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    abortRef.current = new AbortController();

    readyCountsRef.current = {loaded: 0, total: audionStreamsCount};
    buffersRef.current.clear();
    gainNodesRef.current.clear();
    sourcesRef.current.clear();

    const buffers = buffersRef.current;
    const gainNodes = gainNodesRef.current;
    const sources = sourcesRef.current;

    audioUrls.forEach(async (url, idx) => {
      try {
        const res = await fetch(url, {signal: abortRef.current?.signal});
        const arrBuf = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrBuf);
        buffersRef.current.set(idx, buffer);

        const gainNode = ctx.createGain();
        gainNode.gain.value = initialGains[idx] ?? 1;
        gainNodesRef.current.set(idx, gainNode);

        readyCountsRef.current.loaded += 1;

        console.log(`Loaded audio track`, pendingPlayRef.current);
        if (pendingPlayRef.current && videoRef.current && !videoRef.current.paused) {
          startSourceAt(idx, videoRef.current.currentTime);
        }
      } catch (err) {
        if ((err as DOMException).name !== "AbortError") {
          console.error("Failed loading audio track", url, err);
        }
      }
    });

    return () => {
      abortRef.current?.abort();
      sources.forEach((node) => node.stop());
      ctx.close();
      buffers.clear();
      gainNodes.clear();
      sources.clear();
    };
  }, [audioUrls, videoRef, audionStreamsCount, initialGains, startSourceAt]);

  // update gains dynamically
  useEffect(() => {
    gains.forEach((gainValue, idx) => {
      const gainNode = gainNodesRef.current.get(idx);
      if (gainNode) {
        gainNode.gain.value = gainValue;
      }
    });
  }, [gains]);

  // wire up video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = async () => {
      const ctx = ctxRef.current;
      if (!ctx) return;

      await ctx.resume();
      const {loaded, total} = readyCountsRef.current;
      if (total === 0 || loaded === total) {
        pendingPlayRef.current = false;
        startAllAt(video.currentTime);
      } else {
        pendingPlayRef.current = true;
      }
    };

    const handlePause = () => {
      ctxRef.current?.suspend();
      sourcesRef.current.forEach((node) => node.stop());
      sourcesRef.current.clear();
    };

    const handleSeeked = () => startAllAt(video.currentTime);

    const handleWaiting = () => {
      sourcesRef.current.forEach((node) => node.stop());
      sourcesRef.current.clear();
    };

    const handlePlaying = () => startAllAt(video.currentTime);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
    };
  }, [startAllAt, videoRef]);

  return null; // hook currently side-effect only; can return statuses if needed later
}
