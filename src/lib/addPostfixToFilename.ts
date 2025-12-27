function addPostfixToFilename(path: string, postfix: string) {
  const lastSlashIndex = path.lastIndexOf("/");
  const dir = lastSlashIndex !== -1 ? path.slice(0, lastSlashIndex + 1) : "";
  const filename = lastSlashIndex !== -1 ? path.slice(lastSlashIndex + 1) : path;

  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1) {
    // No extension
    return dir + filename + postfix;
  }

  const name = filename.slice(0, lastDotIndex);
  const ext = filename.slice(lastDotIndex);

  return dir + name + postfix + ext;
}

export default addPostfixToFilename;
