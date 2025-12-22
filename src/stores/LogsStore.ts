import React from "react";
import {makeAutoObservable} from "mobx";
import {attachLogger, LogLevel} from "@tauri-apps/plugin-log";
import c from "ansi-colors";

const logLevelsColors = {
  [LogLevel.Trace]: c.dim,
  [LogLevel.Debug]: c.dim,
  [LogLevel.Info]: c.reset,
  [LogLevel.Warn]: c.yellow,
  [LogLevel.Error]: c.red,
}

function mapLine(entry: LogRecord) {
  return `${logLevelsColors[entry.level](entry.message)}`
}

export interface LogRecord {
  level: LogLevel;
  message: string;
}

class LogsStore {
  logs: LogRecord[] = []

  constructor() {
    makeAutoObservable(this, {}, {autoBind: true})

    attachLogger(this.addLogEntry).then(() => {})
  }

  addLogEntry(entry: LogRecord) {
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
}

export const LogsStoreContext = React.createContext<LogsStore>(null!)

export default LogsStore;