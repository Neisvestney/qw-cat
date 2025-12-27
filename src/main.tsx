import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {warn, debug, trace, info, error} from "@tauri-apps/plugin-log";

function forwardConsole(
  fnName: "log" | "debug" | "info" | "warn" | "error",
  logger: (message: string) => Promise<void>,
) {
  const original = console[fnName];
  console[fnName] = (...message) => {
    original.apply(console, message);
    logger(message.map((x) => `${x}`).join("\n"));
  };
}

forwardConsole("log", trace);
forwardConsole("debug", debug);
forwardConsole("info", info);
forwardConsole("warn", warn);
forwardConsole("error", error);

window.addEventListener("error", (e) => {
  console.error(e.type, e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error(e.type, e.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
