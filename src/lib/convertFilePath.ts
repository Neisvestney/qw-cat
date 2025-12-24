export const DEFAULT_INTEGRATED_SERVER_PORT = 38125;

function convertFilePath(path: string, port?: number | null): string
function convertFilePath(path: string | undefined, port?: number | null): string | undefined
function convertFilePath(path: string | undefined, port?: number | null): string | undefined {
  if (!path) return undefined;
  return `http://127.0.0.1:${port ?? DEFAULT_INTEGRATED_SERVER_PORT}/${encodeURIComponent(path)}`;
}

export default convertFilePath;