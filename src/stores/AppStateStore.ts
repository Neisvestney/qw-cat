import React from "react";
import {makeAutoObservable, runInAction, toJS} from "mobx";
import {
  CustomExportPreset,
  detectHwEncoders,
  FfmpegSettings,
  FfmpegSettingsState,
  getCustomExportPresets,
  getFfmpegSettings,
  getIntegratedServerState,
  getRecentVideos,
  openRecentVideo,
  RecentVideo,
  removeRecentVideo,
  saveCustomExportPresets,
  selectNewVideoFile,
  setFfmpegSettings,
} from "../generated";
import VideoEditorStore from "./VideoEditorStore.ts";
import {SelectNewVideoFileEvent} from "../generated/bindings/SelectNewVideoFileEvent.ts";
import FfmpegTasksQueue from "./FfmpegTasksQueue.ts";
import {IntegratedServerStarted} from "../generated/bindings/IntegratedServerStarted.ts";
import {emit} from "@tauri-apps/api/event";
import {AsyncEventsDisposer, createAsyncEventsDisposer} from "../lib/createAsyncEventsDisposer.ts";
import {EXPORT_PRESETS, fromCustomExportPreset} from "../lib/exportPresets.ts";

const PREFER_GPU_KEY = "export.preferGpu";
const LAST_PRESET_KEY = "export.lastPreset";

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings just won't persist
  }
}

class AppStateStore {
  currentVideo: VideoEditorStore | null = null;
  ffmpegTasksQueue = new FfmpegTasksQueue();

  filePickingInProgress = false;
  fileProcessingInfo = false;

  integratedServerStatus: IntegratedServerStarted | null = null;

  // null until the first detection finishes
  hwEncoders: string[] | null = null;

  preferGpuEncoding = readStorage(PREFER_GPU_KEY) == "true";

  // May point to a deleted custom preset, so it's resolved on use
  lastExportPreset: string | null = readStorage(LAST_PRESET_KEY);

  customExportPresets: CustomExportPreset[] = [];

  recentVideos: RecentVideo[] = [];

  get exportPresets() {
    return [...EXPORT_PRESETS, ...this.customExportPresets.map(fromCustomExportPreset)];
  }

  private hwEncodersRequest: Promise<string[]> | null = null;

  // Detected once per session; retried only while ffmpeg is not installed yet
  private hwEncodersFinal = false;

  // Bumped when ffmpeg changes, so a detection still running for the old one is discarded
  private hwEncodersGeneration = 0;

  loadHwEncoders(): Promise<string[]> {
    if (this.hwEncodersFinal && this.hwEncoders) return Promise.resolve(this.hwEncoders);

    const generation = this.hwEncodersGeneration;
    this.hwEncodersRequest ??= detectHwEncoders()
      .catch(() => ({encoders: [], ffmpegInstalled: false}))
      .then((result) => {
        if (generation != this.hwEncodersGeneration) return this.loadHwEncoders();
        runInAction(() => {
          this.hwEncoders = result.encoders;
          this.hwEncodersFinal = result.ffmpegInstalled;
          this.hwEncodersRequest = null;
        });
        return result.encoders;
      });
    return this.hwEncodersRequest;
  }

  setPreferGpuEncoding(preferGpu: boolean) {
    this.preferGpuEncoding = preferGpu;
    writeStorage(PREFER_GPU_KEY, String(preferGpu));
  }

  setLastExportPreset(preset: string) {
    this.lastExportPreset = preset;
    writeStorage(LAST_PRESET_KEY, preset);
  }

  async loadCustomExportPresets() {
    const presets = await getCustomExportPresets();
    runInAction(() => {
      this.customExportPresets = presets;
    });
  }

  addCustomExportPreset(preset: CustomExportPreset) {
    this.customExportPresets.push(preset);
    return this.persistCustomExportPresets();
  }

  renameCustomExportPreset(id: string, title: string) {
    const preset = this.customExportPresets.find((p) => p.id == id);
    if (!preset) return Promise.resolve();
    preset.title = title;
    return this.persistCustomExportPresets();
  }

  deleteCustomExportPreset(id: string) {
    this.customExportPresets = this.customExportPresets.filter((p) => p.id != id);
    if (this.currentVideo?.exportPreset == id) this.currentVideo.setExportPreset("custom");
    return this.persistCustomExportPresets();
  }

  exportPresetsSaveError: string | null = null;

  clearExportPresetsSaveError() {
    this.exportPresetsSaveError = null;
  }

  private persistCustomExportPresets() {
    return saveCustomExportPresets({presets: toJS(this.customExportPresets)}).catch((e) => {
      console.error("Can't save custom export presets", e);
      runInAction(() => {
        this.exportPresetsSaveError = String(e);
      });
    });
  }

  ffmpegSettings: FfmpegSettingsState | null = null;
  settingsDialogOpen = false;

  get ffmpegSourceRequired() {
    return this.ffmpegSettings != null && this.ffmpegSettings.settings.source == null;
  }

  async loadFfmpegSettings() {
    const settings = await getFfmpegSettings();
    runInAction(() => {
      this.ffmpegSettings = settings;
    });
  }

  // Throws when the chosen ffmpeg isn't usable, the caller shows the message
  async saveFfmpegSettings(settings: FfmpegSettings) {
    await setFfmpegSettings({settings});
    runInAction(() => {
      // Another ffmpeg build may support other encoders
      this.hwEncoders = null;
      this.hwEncodersFinal = false;
      this.hwEncodersRequest = null;
      this.hwEncodersGeneration++;
    });
    await this.loadFfmpegSettings();
  }

  openSettingsDialog() {
    this.settingsDialogOpen = true;
    this.loadFfmpegSettings().catch((e) => console.error("Can't load ffmpeg settings", e));
  }

  closeSettingsDialog() {
    this.settingsDialogOpen = false;
  }

  private disposer: AsyncEventsDisposer | null = null;

  get selectNewVideoFileDisabled() {
    return this.filePickingInProgress || this.fileProcessingInfo;
  }

  async selectNewVideoFile() {
    if (this.selectNewVideoFileDisabled) return;

    this.filePickingInProgress = true;
    await selectNewVideoFile();
  }

  async loadRecentVideos() {
    const videos = await getRecentVideos();
    runInAction(() => {
      this.recentVideos = videos;
    });
  }

  async removeRecentVideo(path: string) {
    this.recentVideos = this.recentVideos.filter((v) => v.path != path);
    try {
      await removeRecentVideo({path});
    } catch (e) {
      console.error("Can't remove recent video", e);
      await this.loadRecentVideos();
    }
  }

  async openRecentVideo(path: string) {
    if (this.selectNewVideoFileDisabled) return;

    this.filePickingInProgress = true;
    try {
      await openRecentVideo({path});
    } catch (e) {
      console.error("Can't open recent video", e);
      runInAction(() => {
        this.filePickingInProgress = false;
        this.fileProcessingInfo = false;
      });
      await this.loadRecentVideos();
    }
  }

  closeCurrentVideo() {
    this.currentVideo = null;
  }

  async init() {
    const disposer = createAsyncEventsDisposer();
    this.disposer = disposer;
    this.loadCustomExportPresets().catch((e) =>
      console.error("Can't load custom export presets", e),
    );
    this.loadFfmpegSettings().catch((e) => console.error("Can't load ffmpeg settings", e));
    await this.subscribeToIntegratedServerEvents(disposer);
    await this.subscribeToVideoSelectionEvent(disposer);
    await this.ffmpegTasksQueue.listenToFfmpegEvents(disposer);
    await emit("frontend-initialized").then(() => {
      console.log("Frontend initialized");
    });
  }

  dispose() {
    this.disposer?.dispose();
  }

  async subscribeToVideoSelectionEvent(disposer: AsyncEventsDisposer) {
    await disposer.addListener<SelectNewVideoFileEvent>("select-new-video-file-event", (e) => {
      runInAction(() => {
        console.log("select-new-video-file-event", e.payload);
        switch (e.payload.event) {
          case "videoFilePicked":
            this.filePickingInProgress = false;
            this.fileProcessingInfo = true;
            break;
          case "videoFileInfoReady":
            if (e.payload.videoFile != null) {
              this.currentVideo = new VideoEditorStore(
                this,
                e.payload.videoFile.path,
                e.payload.videoFile.audio_steams,
                e.payload.videoFile.video_stream,
              );
            }
            this.fileProcessingInfo = false;
            break;
          case "videoAudioSteamsReady":
            if (!this.currentVideo) return;
            if (this.currentVideo.path != e.payload.videoFile) return;
            this.currentVideo.updateAudioStreamsFilePaths(e.payload.audioStreams);
            break;
        }
      });
    });
  }

  async subscribeToIntegratedServerEvents(disposer: AsyncEventsDisposer) {
    await disposer.addListener<IntegratedServerStarted>("integrated-server-started", (e) => {
      runInAction(() => {
        this.integratedServerStatus = e.payload;
      });
    });
    const integratedServerState = await getIntegratedServerState();
    if (integratedServerState) {
      runInAction(() => {
        this.integratedServerStatus = integratedServerState;
      });
    }
  }

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});
  }
}

export const AppStateStoreContext = React.createContext<AppStateStore>(null!);

export default AppStateStore;
