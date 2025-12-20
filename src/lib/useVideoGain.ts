import {MutableRefObject, useEffect, useRef} from "react";
import {AudioStream} from "../stores/VideoEditorStore.ts";
import {autorun, toJS} from "mobx";

export function gainToGainValue(v: number) {
  // return (v / 100) ** 3
  return (v / 100)
}

export function useVideoGain(videoRef: MutableRefObject<HTMLVideoElement | null>, audioStream?: AudioStream) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Init audio graph once, when video is mounted
  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioCtxRef.current != null) return;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(video);
    const gainNode = audioCtx.createGain();

    source.connect(gainNode).connect(audioCtx.destination); // video -> gain -> speakers[web:13]

    audioCtxRef.current = audioCtx;
    sourceRef.current = source;
    gainNodeRef.current = gainNode;

    // optional: resume on user interaction somewhere else
    audioCtx.resume().then(r => console.log("resume"));

    return () => {
      // console.log("Close")
      // source.disconnect();
      // gainNode.disconnect();
      // audioCtx.close();
      //
      // audioCtxRef.current = null
      // sourceRef.current = null
      // gainNodeRef.current = null
    };
  }, []);

  useEffect(() => {
    const dispose = autorun(() => {
      const gain = audioStream?.active ? gainToGainValue(audioStream.gain) : 0;
      if (!gainNodeRef.current) return;
      gainNodeRef.current.gain.value = gain
    })

    return () => {
      dispose()
    };
  }, []);

  return audioCtxRef
}