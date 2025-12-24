import React from "react";
import {makeAutoObservable, runInAction} from "mobx";
import {getIntegratedServerState, selectNewVideoFile} from "../generated";
import VideoEditorStore from "./VideoEditorStore.ts";
import {Channel} from "@tauri-apps/api/core";
import {SelectNewVideoFileEvent} from "../generated/bindings/SelectNewVideoFileEvent.ts";
import FfmpegTasksQueue from "./FfmpegTasksQueue.ts";
import {IntegratedServerStarted} from "../generated/bindings/IntegratedServerStarted.ts";
import {listen} from "@tauri-apps/api/event";

class AppStateStore {
  currentVideo: VideoEditorStore | null = null
  ffmpegTasksQueue = new FfmpegTasksQueue()

  filePickingInProgress = false
  fileProcessingInfo = false
  currentSelectNewVideoFileEventChannel: Channel<SelectNewVideoFileEvent> | null = null

  integratedServerStatus: IntegratedServerStarted | null = null

  get selectNewVideoFileDisabled() {
    return this.filePickingInProgress || this.fileProcessingInfo
  }

  async selectNewVideoFile() {
    if (this.selectNewVideoFileDisabled) return;
    if (this.currentSelectNewVideoFileEventChannel != null) this.currentSelectNewVideoFileEventChannel.onmessage = () => {}

    this.filePickingInProgress = true
    this.fileProcessingInfo = false
    const onEvent = new Channel<SelectNewVideoFileEvent>();
    onEvent.onmessage = (message) => {
      runInAction(() => {
        switch (message.event) {
          case "videoFilePicked":
            this.fileProcessingInfo = true
            break;
          case "videoFileInfoReady":
            if (message.videoFile != null) {
              this.currentVideo = new VideoEditorStore(this, message.videoFile.path, message.videoFile.audio_steams)
            } else {

            }
            this.filePickingInProgress = false
            this.fileProcessingInfo = false
            break;
          case "videoAudioSteamsReady":
            this.currentVideo?.updateAudioStreamsFilePaths(message.audioStreams)
            break;
        }
      })
    };

    this.currentSelectNewVideoFileEventChannel = onEvent;
    await selectNewVideoFile({onEvent: onEvent as Channel<any>})
  }

  closeCurrentVideo() {
    this.currentVideo = null;
  }

  async subscribeToIntegratedServerEvents() {
    await listen<IntegratedServerStarted>("integrated-server-started", (e) => {
      runInAction(() => {
        this.integratedServerStatus = e.payload
      })
    })
    const integratedServerState = await getIntegratedServerState()
    if (integratedServerState) this.integratedServerStatus = integratedServerState
  }

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true})

    this.subscribeToIntegratedServerEvents()
  }
}

export const AppStateStoreContext = React.createContext<AppStateStore>(null!)

export default AppStateStore;