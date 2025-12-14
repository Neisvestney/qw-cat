import {makeAutoObservable, runInAction} from "mobx";
import {VideoAudioStreamsInfo} from "../generated/bindings/VideoAudioStreamsInfo.ts";
import {AudioStreamFilePath} from "../generated/bindings/AudioStreamFilePath.ts";
import addPostfixToFilename from "../lib/addPostfixToFilename.ts";
import replaceExtension from "../lib/replaceExtension.ts";
import estimateVideoSize from "../lib/estimateVideoSize.ts";

const MINIMAL_SECONDS_DIFF = 1

class VideoEditorStore {
  path: string
  audioStreamsInfo: VideoAudioStreamsInfo
  audioStreamsFilePaths: AudioStreamFilePath[] | null = null
  duration: number | null
  trimStart: number | null
  trimEnd: number | null

  videoCurrentTime: number | null = null

  activeAudioStreamIndexes: number[]

  setVideoDuration(duration: number) {
    this.duration = duration;
    this.trimStart = 0;
    this.trimEnd = duration;
    this.videoCurrentTime = 0;
  }

  updateVideoTrimValues(trimStart: number, trimEnd: number) {
    if (!this.duration) return;

    if (trimEnd - trimStart < MINIMAL_SECONDS_DIFF) return;

    this.trimStart = trimStart >= 0 ? trimStart : 0
    this.trimEnd = trimEnd <= this.duration ? trimEnd : this.duration
  }

  get startHereDisabled() {
    if (this.trimEnd == null || this.videoCurrentTime == null) return true;
    return this.trimEnd - MINIMAL_SECONDS_DIFF < this.videoCurrentTime
  }

  handleStartHere() {
    if(this.startHereDisabled) return;
    this.trimStart = this.videoCurrentTime;
  }

  get endHereDisabled() {
    if (this.trimStart == null || this.videoCurrentTime == null) return true;
    return this.trimStart + MINIMAL_SECONDS_DIFF > this.videoCurrentTime
  }

  handleEndHere() {
    if(this.endHereDisabled) return;
    this.trimEnd = this.videoCurrentTime;
  }

  updateAudioStreamsFilePaths(audioStreamsFilePaths: AudioStreamFilePath[]) {
    this.audioStreamsFilePaths = audioStreamsFilePaths;
  }

  toggleAudioStream(streamIndex: number) {
    const index = this.activeAudioStreamIndexes.indexOf(streamIndex);
    if (index > -1) {
      this.activeAudioStreamIndexes.splice(index, 1);
    } else {
      this.activeAudioStreamIndexes.push(streamIndex);
    }
  }

  getAudioStreamFilePath(streamIndex: number) {
    return this.audioStreamsFilePaths?.find(x => x.index == streamIndex) ?? null
  }

  get defaultAudioStreamIndex() {
    return this.audioStreamsInfo.audioStreams[0].index;
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

  constructor(path: string, videoAudioStreamsInfo: VideoAudioStreamsInfo = {audioStreams: [], duration: 0}) {
    makeAutoObservable(this, {}, {autoBind: true})

    this.path = path;
    this.audioStreamsInfo = videoAudioStreamsInfo;
    this.activeAudioStreamIndexes = videoAudioStreamsInfo.audioStreams.map(x => x.index);
    this.duration = null;
    this.trimStart = null;
    this.trimEnd = null;

    this.setExportPath(addPostfixToFilename(path, " - Trim"))
  }
}

export default VideoEditorStore;