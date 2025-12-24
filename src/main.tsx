import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {attachConsole} from "@tauri-apps/plugin-log";
import { warn, debug, trace, info, error } from '@tauri-apps/plugin-log';
import {stringifyCircular} from "./lib/stringifyCircular.ts";

function forwardConsole(
  fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
  logger: (message: string) => Promise<void>
) {
  const original = console[fnName];
  console[fnName] = (...message) => {
    original(...message);
    logger(message.map(x => `${x}`).join('\n'));
  };
}

forwardConsole('log', trace);
forwardConsole('debug', debug);
forwardConsole('info', info);
forwardConsole('warn', warn);
forwardConsole('error', error);

window.addEventListener("error", (e) => {
  console.error(e.type, e.message)
})

window.addEventListener("unhandledrejection", (e) => {
  console.error(e.type, e.reason)
})

// attachConsole().then(() => console.log("Attached main process console"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>,
);
