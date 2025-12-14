/**
 * Estimate video file size
 * @param {number} bitrateKbps - Video bitrate in kilobits per second
 * @param {number} durationSeconds - Video duration in seconds
 * @returns {number} Estimated size in megabytes (MB)
 */
function estimateVideoSize(bitrateKbps: number, durationSeconds: number) {
  return Math.round((bitrateKbps * durationSeconds) / (8 * 1024));
}

export default estimateVideoSize;