const FILES_HOST_SERVER_PORT = 38125;

function convertFilePath(path: string): string
function convertFilePath(path: string | undefined): string | undefined
function convertFilePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return `http://127.0.0.1:${FILES_HOST_SERVER_PORT}/${encodeURI(path)}`;
}

export default convertFilePath;