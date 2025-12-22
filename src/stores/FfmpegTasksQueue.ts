import {makeAutoObservable, runInAction} from "mobx";
import {listen} from "@tauri-apps/api/event";
import {FfmpegTask} from "../generated/bindings/FfmpegTask.ts";

class FfmpegTasksQueue {
  ffmpegTasks: FfmpegTask[] = []

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true})
    const _ = this.listenToFfmpegEvents()
  }

  get lastInProgressOrLastTaskFromQueue() {
    if (this.ffmpegTasks.length == 0) return null;
    const lastInProgressTask = this.ffmpegTasks.slice().reverse().find(x => x.status.type == "inProgress") ?? null;
    return lastInProgressTask ?? this.ffmpegTasks[this.ffmpegTasks.length - 1]
  }

  async listenToFfmpegEvents() {
    await listen<FfmpegTask[]>("ffmpeg-queue", (message) => {
      runInAction(() => {
        this.ffmpegTasks = message.payload;
      })
    })
  }
}

export default FfmpegTasksQueue;