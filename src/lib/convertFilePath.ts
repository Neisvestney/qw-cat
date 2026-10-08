import {IntegratedServerStarted} from "../generated/bindings/IntegratedServerStarted.ts";

function convertFilePath(path: string | undefined, server: IntegratedServerStarted | null): string | undefined {
  if (!path || !server) return undefined;
  return `http://127.0.0.1:${server.port}/${server.token}/${encodeURIComponent(path)}`;
}

export default convertFilePath;
