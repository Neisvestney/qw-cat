function replaceExtension(path: string, newExt: string) {
  return path.replace(/\.[^/.]+$/, newExt.startsWith('.') ? newExt : '.' + newExt);
}

export default replaceExtension;