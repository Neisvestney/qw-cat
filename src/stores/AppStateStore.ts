import React from "react";
import {makeAutoObservable, runInAction} from "mobx";
import {getIntegratedServerState, selectNewVideoFile} from "../generated";
import VideoEditorStore from "./VideoEditorStore.ts";
import {SelectNewVideoFileEvent} from "../generated/bindings/SelectNewVideoFileEvent.ts";
import FfmpegTasksQueue from "./FfmpegTasksQueue.ts";
import {IntegratedServerStarted} from "../generated/bindings/IntegratedServerStarted.ts";
import {emit} from "@tauri-apps/api/event";
import {AsyncEventsDisposer, createAsyncEventsDisposer} from "../lib/createAsyncEventsDisposer.ts";

class AppStateStore {
  currentVideo: VideoEditorStore | null = null;
  ffmpegTasksQueue = new FfmpegTasksQueue();

  filePickingInProgress = false;
  fileProcessingInfo = false;

  integratedServerStatus: IntegratedServerStarted | null = null;

  private disposer: AsyncEventsDisposer | null = null;

  get selectNewVideoFileDisabled() {
    return this.filePickingInProgress || this.fileProcessingInfo;
  }

  async selectNewVideoFile() {
    if (this.selectNewVideoFileDisabled) return;

    this.filePickingInProgress = true;
    await selectNewVideoFile();
  }

  closeCurrentVideo() {
    this.currentVideo = null;
  }

  async init() {
    const disposer = createAsyncEventsDisposer();
    this.disposer = disposer;
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
    if (integratedServerState) this.integratedServerStatus = integratedServerState;
  }

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});
  }
}

export const AppStateStoreContext = React.createContext<AppStateStore>(null!);

export default AppStateStore;
