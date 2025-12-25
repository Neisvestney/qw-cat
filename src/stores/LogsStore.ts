import React from "react";
import {makeAutoObservable, runInAction} from "mobx";
import {attachLogger, LogLevel} from "@tauri-apps/plugin-log";
import c from "ansi-colors";
import {getLogs} from "../generated";
import {AsyncEventsDisposer, createAsyncEventsDisposer} from "../lib/createAsyncEventsDisposer.ts";

const logLevelsColors = {
  [LogLevel.Trace]: c.grey,
  [LogLevel.Debug]: c.grey,
  [LogLevel.Info]: c.reset,
  [LogLevel.Warn]: c.yellow,
  [LogLevel.Error]: c.red,
}

function mapLine(entry: LogRecord) {
  return `${logLevelsColors[entry.level](c.stripColor(entry.message))}`
}

export interface LogRecord {
  level: LogLevel;
  message: string;
}

class LogsStore {
  logs: LogRecord[] = []

  private disposer: AsyncEventsDisposer | null = null;

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true})
  }

  async init() {
    let disposer = createAsyncEventsDisposer()
    this.disposer = disposer;
    await disposer.add(() => attachLogger((e) => this.addLogEntry(e, disposer)))
    await this.fetchLogs()
  }

  dispose() {
    this.disposer?.dispose()
  }

  addLogEntry(entry: LogRecord, disposer: AsyncEventsDisposer) {
    if (disposer.isDisposed) return;
    this.logs.push(entry)
  }

  logsWindowOpen = false

  setLogsWindowOpen(open: boolean) {
    this.logsWindowOpen = open;
  }

  get lines() {
    return this.logs.map(mapLine)
  }

  get lastLine() {
    const entry = this.logs[this.logs.length - 1]
    return entry ? mapLine(entry) : ""
  }

  async fetchLogs() {
    const log = await getLogs()
    runInAction(() => {
      this.logs.push(...log as unknown as LogRecord[])
    })
  }
}

export const LogsStoreContext = React.createContext<LogsStore>(null!)

export default LogsStore;