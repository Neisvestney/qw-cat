import {makeAutoObservable, runInAction, trace} from "mobx";
import {VideoAudioStreamsInfo} from "../generated/bindings/VideoAudioStreamsInfo.ts";
import {AudioStreamFilePath} from "../generated/bindings/AudioStreamFilePath.ts";
import addPostfixToFilename from "../lib/addPostfixToFilename.ts";
import replaceExtension from "../lib/replaceExtension.ts";
import estimateVideoSize from "../lib/estimateVideoSize.ts";
import {ffmpegExport, GpuAcceleration} from "../generated";
import theme from "../theme.ts";
import {gainToGainValue} from "../lib/useVideoGain.ts";

export interface AudioStream {
  streamIndex: number;
  active: boolean;
  gain: number;
  path: string | null;
}

type Nullable<T> = {
  [P in keyof T]: T[P] | null;
};

export interface VideoState {
  time: number;
  playing: boolean;
  loading: boolean;
  fullscreen: boolean;
}

const MINIMAL_SECONDS_DIFF = 1

class VideoEditorStore {
  path: string
  audioStreams: AudioStream[]
  duration: number | null
  trimStart: number | null
  trimEnd: number | null

  videoState: VideoState = {
    time: 0,
    playing: false,
    loading: false,
    fullscreen: false,
  }

  videoTargetState: Nullable<VideoState> = {
    time: null,
    playing: null,
    loading: null,
    fullscreen: null,
  }

  setVideoDuration(duration: number) {
    this.duration = duration;
    this.trimStart = 0;
    this.trimEnd = duration;
    this.videoState.time = 0;
  }

  updateVideoTrimValues(trimStart: number, trimEnd: number) {
    if (!this.duration) return;

    if (trimEnd - trimStart < MINIMAL_SECONDS_DIFF) return;

    this.trimStart = trimStart >= 0 ? trimStart : 0
    this.trimEnd = trimEnd <= this.duration ? trimEnd : this.duration
  }

  get startHereDisabled() {
    if (this.trimEnd == null || this.videoState.time == null) return true;
    return this.trimEnd - MINIMAL_SECONDS_DIFF < this.videoState.time
  }

  handleStartHere() {
    if(this.startHereDisabled) return;
    this.trimStart = this.videoState.time;
  }

  get endHereDisabled() {
    if (this.trimStart == null || this.videoState.time == null) return true;
    return this.trimStart + MINIMAL_SECONDS_DIFF > this.videoState.time
  }

  handleEndHere() {
    if(this.endHereDisabled) return;
    this.trimEnd = this.videoState.time;
  }

  handlePlayFromStart() {
    this.setVideoTime(this.trimStart ?? 0);
  }

  updateAudioStreamsFilePaths(audioStreamsFilePaths: AudioStreamFilePath[]) {
    for (const audioStreamsFilePath of audioStreamsFilePaths) {
      const index = this.audioStreams.findIndex(x => x.streamIndex == audioStreamsFilePath.index);
      if (index != -1) this.audioStreams[index].path = audioStreamsFilePath.path;
    }
  }

  toggleAudioStream(streamIndex: number) {
    const index = this.audioStreams.findIndex(x => x.streamIndex == streamIndex)
    if (index != -1) {
      this.audioStreams[index].active = !this.audioStreams[index].active;
    }
  }

  updateAudioStreamGain(streamIndex: number, gain: number) {
    const index = this.audioStreams.findIndex(x => x.streamIndex == streamIndex)
    if (index != -1) {
      this.audioStreams[index].gain = gain;
    }
  }

  handleVideoStateChange<K extends keyof VideoState>(key: K, value: VideoState[K]) {
    this.videoState[key] = value;
    this.videoTargetState[key] = null;
  }

  setVideoTime(time: number) {
    this.videoState.time = time;
    this.videoTargetState.time = time;
  }

  seekVideoBy(seconds: number) {
    this.setVideoTime(Math.min(this.duration ?? 0, Math.max(0, this.videoState.time + seconds)));
  }

  setVideoPlaying(playing: boolean) {
    this.videoState.playing = playing;
    this.videoTargetState.playing = playing;
  }

  toggleVideoPlaying() {
    console.log("toggleVideoPlaying", this.videoState.playing)
    this.setVideoPlaying(!this.videoState.playing);
  }

  setVideoFullscreen(fullscreen: boolean) {
    this.videoState.fullscreen = fullscreen;
    this.videoTargetState.fullscreen = fullscreen;
  }

  toggleVideoFullscreen() {
    this.setVideoFullscreen(!this.videoState.fullscreen);
  }

  get defaultAudioStream() {
    return this.audioStreams[0];
  }

  get defaultAudioStreamIndex() {
    return this.defaultAudioStream.streamIndex;
  }

  get trimDurationSeconds() {
    return (this.trimEnd ?? 0) - (this.trimStart ?? 0);
  }

  get estimatedVideoSizeMb() {
    return estimateVideoSize(this.exportBitrateKbps ?? 0, this.trimDurationSeconds);
  }

  exportPath: string = ""
  setExportPath(path: string) {
    this.exportPath = path;

    const filePathParts = path.split('.');
    this.exportFormat = filePathParts.length > 1 ? filePathParts[filePathParts.length - 1] : "";
  }

  exportFormat: string = ""
  setExportFormat(format: string) {
    this.exportFormat = format;
    this.exportPath = replaceExtension(this.exportPath, this.exportFormat);
  }

  exportResolution: string = "1920x1080"
  setExportResolution(resolution: string) {
    this.exportResolution = resolution;
  }

  exportBitrateKbps: number | null = null
  setExportBitrateKbps(bitrateKbps: number | null) {
    this.exportBitrateKbps = bitrateKbps;
  }

  exportFrameRate: number | null = 60
  setExportFrameRate(exportFrameRate: number | null) {
    this.exportFrameRate = exportFrameRate;
  }

  exportVideoEncoder: string | null = null
  setExportVideoEncoder(exportVideoEncoder: string | null) {
    this.exportVideoEncoder = exportVideoEncoder;
  }

  exportGpuAcceleration: GpuAcceleration | null = null
  setExportGpuAcceleration(exportGpuAcceleration: GpuAcceleration | null) {
    this.exportGpuAcceleration = exportGpuAcceleration;

    switch (exportGpuAcceleration) {
      case "nvidia":
        if (this.exportVideoEncoder == null && this.exportFormat == "mp4") this.exportVideoEncoder = "h264_nvenc";
        break;
    }
  }

  async exportVideo() {
    await ffmpegExport({
      options: {
        inputPath: this.path,
        outputPath: this.exportPath,
        startTime: this.trimStart ?? 0,
        endTime: this.trimEnd ?? 0,
        bitrate: this.exportBitrateKbps ? `${this.exportBitrateKbps}k` : null,
        resolution: this.exportResolution.replace("x", ":"),
        frameRate: this.exportFrameRate,
        videoCodec: this.exportVideoEncoder,
        gpuAcceleration: this.exportGpuAcceleration,
        activeAudioStreams: this.audioStreams.filter(x => x.active).map(x => ({
          index: x.streamIndex,
          gain: gainToGainValue(x.gain)
        })),
      }
    })
  }

  constructor(path: string, videoAudioStreamsInfo: VideoAudioStreamsInfo = {audioStreams: [], duration: 0}) {
    makeAutoObservable(this, {}, {autoBind: true})

    this.path = path;
    this.audioStreams = videoAudioStreamsInfo.audioStreams.map(x => ({
      streamIndex: x.index,
      active: true,
      gain: 100,
      path: null,
    }));
    this.duration = null;
    this.trimStart = null;
    this.trimEnd = null;

    this.setExportPath(addPostfixToFilename(path, " - Trim"))
  }
}

export default VideoEditorStore;