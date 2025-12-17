import React from "react";
import {makeAutoObservable, runInAction} from "mobx";
import {selectNewVideoFile} from "../generated";
import VideoEditorStore from "./VideoEditorStore.ts";
import {Channel} from "@tauri-apps/api/core";
import {SelectNewVideoFileEvent} from "../generated/bindings/SelectNewVideoFileEvent.ts";
import FfmpegTasksQueue from "./FfmpegTasksQueue.ts";

class AppStateStore {
  currentVideo: VideoEditorStore | null = null
  ffmpegTasksQueue = new FfmpegTasksQueue()

  filePickingInProgress = false
  fileProcessingInfo = false
  currentSelectNewVideoFileEventChannel: Channel<SelectNewVideoFileEvent> | null = null

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
              this.currentVideo = new VideoEditorStore(message.videoFile.path, message.videoFile.audio_steams)
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

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true})
  }
}

export const AppStateStoreContext = React.createContext<AppStateStore>(null!)

export default AppStateStore;