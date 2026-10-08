import {makeAutoObservable} from "mobx";
import {VideoAudioStreamsInfo} from "../generated/bindings/VideoAudioStreamsInfo.ts";
import {AudioStreamFilePath} from "../generated/bindings/AudioStreamFilePath.ts";
import addPostfixToFilename from "../lib/addPostfixToFilename.ts";
import replaceExtension from "../lib/replaceExtension.ts";
import estimateVideoSize from "../lib/estimateVideoSize.ts";
import {ffmpegExport, GpuAcceleration} from "../generated";
import {gainToGainValue} from "../lib/useAudioMixer.ts";
import convertFilePath from "../lib/convertFilePath.ts";
import AppStateStore from "./AppStateStore.ts";
import {VideoStreamInfo} from "../generated/bindings/VideoStreamInfo.ts";
import {
  AUDIO_BITRATE_KBPS,
  encoderVendor,
  ExportPreset,
  ExportPresetId,
  firstCompatibleContainer,
  hasAudio,
  isContainerCompatible,
  MAX_BITRATE_KBPS,
  resolvePresetCodec,
  scaledResolution,
  supportsBitrate,
} from "../lib/exportPresets.ts";

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

const MINIMAL_SECONDS_DIFF = 1;
const MIN_TARGET_BITRATE_KBPS = 300;

class VideoEditorStore {
  appStateStore: AppStateStore;

  path: string;
  sourceVideo: VideoStreamInfo | null;
  audioStreams: AudioStream[];
  duration: number | null;
  trimStart: number | null;
  trimEnd: number | null;
  playbackVolume = 100;
  playbackMuted = false;

  videoState: VideoState = {
    time: 0,
    playing: false,
    loading: false,
    fullscreen: false,
  };

  videoTargetState: Nullable<VideoState> = {
    time: null,
    playing: null,
    loading: null,
    fullscreen: null,
  };

  videoPlayerError: ErrorEvent | null = null;

  getVideoPath() {
    return convertFilePath(this.path, this.appStateStore.integratedServerStatus);
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

    this.trimStart = trimStart >= 0 ? trimStart : 0;
    this.trimEnd = trimEnd <= this.duration ? trimEnd : this.duration;
  }

  get startHereDisabled() {
    if (this.trimEnd == null || this.videoState.time == null) return true;
    return this.trimEnd - MINIMAL_SECONDS_DIFF < this.videoState.time;
  }

  handleStartHere() {
    if (this.startHereDisabled) return;
    this.trimStart = this.videoState.time;
  }

  get endHereDisabled() {
    if (this.trimStart == null || this.videoState.time == null) return true;
    return this.trimStart + MINIMAL_SECONDS_DIFF > this.videoState.time;
  }

  handleEndHere() {
    if (this.endHereDisabled) return;
    this.trimEnd = this.videoState.time;
  }

  handlePlayFromStart() {
    this.setVideoTime(this.trimStart ?? 0);
  }

  changePlaybackVolume(volume: number) {
    this.playbackVolume = volume;
    this.playbackMuted = false;
  }

  togglePlaybackMuted() {
    if (this.playbackVolume == 0) {
      this.playbackMuted = false;
      this.playbackVolume = 10;
    } else {
      this.playbackMuted = !this.playbackMuted;
    }
  }

  get effectivePlaybackVolume() {
    return this.playbackMuted ? 0 : this.playbackVolume;
  }

  get effectivePlaybackMuted() {
    return this.playbackMuted || this.playbackVolume == 0;
  }

  updateAudioStreamsFilePaths(audioStreamsFilePaths: AudioStreamFilePath[]) {
    for (const audioStreamsFilePath of audioStreamsFilePaths) {
      const index = this.audioStreams.findIndex((x) => x.streamIndex == audioStreamsFilePath.index);
      if (index != -1) this.audioStreams[index].path = audioStreamsFilePath.path;
    }
  }

  toggleAudioStream(streamIndex: number) {
    const index = this.audioStreams.findIndex((x) => x.streamIndex == streamIndex);
    if (index != -1) {
      this.audioStreams[index].active = !this.audioStreams[index].active;
    }
  }

  updateAudioStreamGain(streamIndex: number, gain: number) {
    const index = this.audioStreams.findIndex((x) => x.streamIndex == streamIndex);
    if (index != -1) {
      this.audioStreams[index].gain = gain;
    }
  }

  handleVideoPlayerError(error: ErrorEvent) {
    this.videoPlayerError = error;
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

  get audioBitrateKbps() {
    return hasAudio(this.exportVideoEncoder) ? AUDIO_BITRATE_KBPS : 0;
  }

  get rawTargetSizeBitrateKbps() {
    if (this.exportTargetSizeMb == null || this.trimDurationSeconds <= 0) return null;
    // 5% margin because single-pass encoders overshoot the requested bitrate
    const totalKbps = (this.exportTargetSizeMb * 0.95 * 8 * 1024) / this.trimDurationSeconds;
    return Math.floor(totalKbps - this.audioBitrateKbps);
  }

  get targetSizeBitrateKbps() {
    const raw = this.rawTargetSizeBitrateKbps;
    return raw == null ? null : Math.min(MAX_BITRATE_KBPS, Math.max(MIN_TARGET_BITRATE_KBPS, raw));
  }

  get targetSizeUnreachable() {
    const raw = this.rawTargetSizeBitrateKbps;
    return raw != null && raw < MIN_TARGET_BITRATE_KBPS;
  }

  get exportContainerCompatible() {
    return isContainerCompatible(this.exportFormat, this.exportVideoEncoder);
  }

  get effectiveBitrateKbps() {
    return this.targetSizeBitrateKbps ?? this.exportBitrateKbps;
  }

  get estimatedVideoSizeMb() {
    if (this.effectiveBitrateKbps == null) return null;
    return estimateVideoSize(
      this.effectiveBitrateKbps + this.audioBitrateKbps,
      this.trimDurationSeconds,
    );
  }

  exportPath = "";

  setExportPath(path: string) {
    this.exportPath = path;

    const fileName = path.split(/[\\/]/).pop() ?? "";
    const dotIndex = fileName.lastIndexOf(".");
    this.exportFormat = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
  }

  exportFormat = "";

  exportPreset: ExportPresetId | "custom" | null = null;

  setExportPreset(preset: ExportPresetId | "custom" | null) {
    this.exportPreset = preset;
  }

  applyExportPreset(preset: ExportPreset, hwEncoders: string[], preferGpu: boolean) {
    const codec = resolvePresetCodec(preset, hwEncoders, preferGpu);
    if (!codec) return;

    this.exportPreset = preset.id;
    this.setExportCodec(codec);
    this.setExportFormat(preset.container);
    this.exportResolution = preset.shortSide
      ? scaledResolution(this.sourceVideo, preset.shortSide)
      : null;
    this.exportFrameRate = preset.frameRate;
    this.exportBitrateKbps = preset.bitrateKbps;
    this.exportTargetSizeMb = preset.targetSizeMb;
  }

  setExportFormat(format: string) {
    this.exportFormat = format;
    this.exportPath = replaceExtension(this.exportPath, this.exportFormat);
  }

  // null keeps the source resolution
  exportResolution: string | null = null;

  setExportResolution(resolution: string | null) {
    this.exportResolution = resolution;
  }

  exportBitrateKbps: number | null = null;

  setExportBitrateKbps(bitrateKbps: number | null) {
    this.exportBitrateKbps = bitrateKbps;
    this.exportTargetSizeMb = null;
  }

  exportTargetSizeMb: number | null = null;

  setExportTargetSizeMb(targetSizeMb: number | null) {
    this.exportTargetSizeMb = targetSizeMb;
    if (targetSizeMb != null) this.exportBitrateKbps = null;
  }

  // null keeps the source frame rate
  exportFrameRate: number | null = null;

  setExportFrameRate(exportFrameRate: number | null) {
    this.exportFrameRate = exportFrameRate;
  }

  exportVideoEncoder: string | null = "libx264";

  exportGpuAcceleration: GpuAcceleration | null = null;

  setExportCodec(codec: string) {
    this.exportVideoEncoder = codec;
    const vendor = encoderVendor(codec);
    this.exportGpuAcceleration = vendor == "cpu" ? null : vendor;
    if (!supportsBitrate(codec)) {
      this.exportBitrateKbps = null;
      this.exportTargetSizeMb = null;
    }
    if (!isContainerCompatible(this.exportFormat, codec))
      this.setExportFormat(firstCompatibleContainer(codec));
  }

  async exportVideo() {
    await ffmpegExport({
      options: {
        inputPath: this.path,
        outputPath: this.exportPath,
        startTime: this.trimStart ?? 0,
        endTime: this.trimEnd ?? 0,
        bitrate: this.effectiveBitrateKbps ? `${this.effectiveBitrateKbps}k` : null,
        resolution: this.exportResolution?.replace("x", ":") ?? null,
        frameRate: this.exportFrameRate,
        videoCodec: this.exportVideoEncoder,
        gpuAcceleration: this.exportGpuAcceleration,
        activeAudioStreams: this.audioStreams
          .filter((x) => x.active)
          .map((x) => ({
            index: x.streamIndex,
            gain: gainToGainValue(x.gain),
          })),
      },
    });
  }

  constructor(
    appStateStore: AppStateStore,
    path: string,
    videoAudioStreamsInfo: VideoAudioStreamsInfo = {audioStreams: [], duration: 0},
    sourceVideo: VideoStreamInfo | null = null,
  ) {
    makeAutoObservable(this, {}, {autoBind: true});

    this.appStateStore = appStateStore;

    this.path = path;
    this.sourceVideo = sourceVideo;
    this.audioStreams = videoAudioStreamsInfo.audioStreams.map((x) => ({
      streamIndex: x.index,
      active: true,
      gain: 100,
      path: null,
    }));
    this.duration = null;
    this.trimStart = null;
    this.trimEnd = null;

    this.setVideoDuration(videoAudioStreamsInfo.duration);
    this.setExportPath(addPostfixToFilename(path, " - Trim"));
    if (!isContainerCompatible(this.exportFormat, this.exportVideoEncoder)) {
      this.exportVideoEncoder = "libvpx-vp9";
    }
  }
}

export default VideoEditorStore;
