import {makeAutoObservable, runInAction} from "mobx";
import {FfmpegTask} from "../generated/bindings/FfmpegTask.ts";
import {AsyncEventsDisposer} from "../lib/createAsyncEventsDisposer.ts";

class FfmpegTasksQueue {
  ffmpegTasks: FfmpegTask[] = [];

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true});
  }

  get lastInProgressOrLastTaskFromQueue() {
    if (this.ffmpegTasks.length == 0) return null;
    const lastInProgressTask =
      this.ffmpegTasks
        .slice()
        .reverse()
        .find((x) => x.status.type == "inProgress") ?? null;
    return lastInProgressTask ?? this.ffmpegTasks[this.ffmpegTasks.length - 1];
  }

  async listenToFfmpegEvents(disposer: AsyncEventsDisposer) {
    await disposer.addListener<FfmpegTask[]>("ffmpeg-queue", (message) => {
      runInAction(() => {
        this.ffmpegTasks = message.payload;
      });
    });
  }
}

export default FfmpegTasksQueue;
