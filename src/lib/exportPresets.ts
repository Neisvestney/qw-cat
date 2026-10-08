import {GpuAcceleration} from "../generated";
import {VideoStreamInfo} from "../generated/bindings/VideoStreamInfo.ts";

export type CodecFamily = "h264" | "hevc" | "av1" | "vp9";
export type EncoderVendor = "cpu" | GpuAcceleration;

export interface EncoderInfo {
  vendor: EncoderVendor;
  label: string;
  codecs: string[];
}

export const ENCODERS: EncoderInfo[] = [
  {vendor: "cpu", label: "CPU", codecs: ["libx264", "libx265", "libvpx-vp9"]},
  {vendor: "nvidia", label: "NVIDIA NVENC", codecs: ["h264_nvenc", "hevc_nvenc", "av1_nvenc"]},
  {vendor: "amd", label: "AMD AMF", codecs: ["h264_amf", "hevc_amf", "av1_amf"]},
  {
    vendor: "intel",
    label: "Intel Quick Sync",
    codecs: ["h264_qsv", "hevc_qsv", "av1_qsv", "vp9_qsv"],
  },
];

const FAMILY_LABELS: Record<CodecFamily, string> = {
  h264: "H.264",
  hevc: "HEVC",
  av1: "AV1",
  vp9: "VP9",
};

const FAMILY_DESCRIPTIONS: Record<CodecFamily, string> = {
  h264: "Plays everywhere",
  hevc: "Smaller files",
  av1: "Smallest files, newer GPUs",
  vp9: "For WebM",
};

const CPU_CODEC_LABELS: Record<string, string> = {
  libx264: "x264",
  libx265: "x265",
  "libvpx-vp9": "VP9",
};

const GPU_ORDER: GpuAcceleration[] = ["nvidia", "amd", "intel"];
const GPU_SUFFIX: Record<GpuAcceleration, string> = {nvidia: "nvenc", amd: "amf", intel: "qsv"};
const CPU_CODECS: Partial<Record<CodecFamily, string>> = {
  h264: "libx264",
  hevc: "libx265",
  vp9: "libvpx-vp9",
};

export function codecFamily(codec: string | null): CodecFamily | null {
  if (!codec) return null;
  if (codec == "libx264" || codec.startsWith("h264_")) return "h264";
  if (codec == "libx265" || codec.startsWith("hevc_")) return "hevc";
  if (codec == "libvpx-vp9" || codec.startsWith("vp9_")) return "vp9";
  if (codec.startsWith("av1_")) return "av1";
  return null;
}

export function codecLabel(codec: string) {
  const family = codecFamily(codec);
  return family ? FAMILY_LABELS[family] : codec;
}

export function codecDescription(codec: string) {
  const family = codecFamily(codec);
  return family ? FAMILY_DESCRIPTIONS[family] : "";
}

export function encoderVendor(codec: string | null): EncoderVendor {
  return ENCODERS.find((e) => codec && e.codecs.includes(codec))?.vendor ?? "cpu";
}

export function encoderLabel(vendor: EncoderVendor) {
  return ENCODERS.find((e) => e.vendor == vendor)?.label ?? vendor;
}

export function isCodecAvailable(codec: string, hwEncoders: string[]) {
  return encoderVendor(codec) == "cpu" || hwEncoders.includes(codec);
}

export function isVendorAvailable(vendor: EncoderVendor, hwEncoders: string[]) {
  if (vendor == "cpu") return true;
  return ENCODERS.find((e) => e.vendor == vendor)!.codecs.some((c) => hwEncoders.includes(c));
}

export const CONTAINERS = ["mp4", "mkv", "mov", "webm"];

// Containers missing here (avi, flv, ...) are left to ffmpeg
const CONTAINER_CODECS: Record<string, CodecFamily[]> = {
  mp4: ["h264", "hevc", "av1", "vp9"],
  m4v: ["h264", "hevc", "av1", "vp9"],
  mkv: ["h264", "hevc", "av1", "vp9"],
  mov: ["h264", "hevc"],
  webm: ["vp9", "av1"],
};

export function isContainerCompatible(container: string, codec: string | null) {
  const family = codecFamily(codec);
  const supported = CONTAINER_CODECS[container];
  return !supported || !family || supported.includes(family);
}

export type ExportPresetId = "discord" | "hq" | "web" | "fast";

export interface ExportPreset {
  id: ExportPresetId;
  title: string;
  description: string;
  details: string;
  family: CodecFamily;
  container: string;
  // Short side in pixels, null keeps the source resolution
  shortSide: number | null;
  bitrateKbps: number | null;
  targetSizeMb: number | null;
  gpu: "optional" | "default" | "required";
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "discord",
    title: "Discord",
    description: "Fits the free 10 MB upload limit",
    details: "720p · auto bitrate",
    family: "h264",
    container: "mp4",
    shortSide: 720,
    bitrateKbps: null,
    targetSizeMb: 10,
    gpu: "optional",
  },
  {
    id: "hq",
    title: "High quality",
    description: "For YouTube or editing later",
    details: "source · 12 Mbit/s",
    family: "hevc",
    container: "mp4",
    shortSide: null,
    bitrateKbps: 12000,
    targetSizeMb: null,
    gpu: "default",
  },
  {
    id: "web",
    title: "Web / WebM",
    description: "Plays in any browser",
    details: "1080p · 4 Mbit/s",
    family: "vp9",
    container: "webm",
    shortSide: 1080,
    bitrateKbps: 4000,
    targetSizeMb: null,
    gpu: "optional",
  },
  {
    id: "fast",
    title: "Fast (GPU)",
    description: "Hardware encode, a few seconds",
    details: "source · 8 Mbit/s",
    family: "h264",
    container: "mp4",
    shortSide: null,
    bitrateKbps: 8000,
    targetSizeMb: null,
    gpu: "required",
  },
];

export function findExportPreset(id: string | null) {
  return EXPORT_PRESETS.find((p) => p.id == id) ?? null;
}

export function resolvePresetCodec(preset: ExportPreset, hwEncoders: string[], preferGpu: boolean) {
  if (preset.gpu != "optional" || preferGpu) {
    for (const vendor of GPU_ORDER) {
      const codec = `${preset.family}_${GPU_SUFFIX[vendor]}`;
      if (hwEncoders.includes(codec)) return codec;
    }
  }
  if (preset.gpu == "required") return null;
  return CPU_CODECS[preset.family] ?? null;
}

export function codecShortLabel(codec: string) {
  const vendor = encoderVendor(codec);
  if (vendor == "cpu") return `${CPU_CODEC_LABELS[codec] ?? codec} · CPU`;
  return `${codecLabel(codec)} · ${vendor == "nvidia" ? "NVIDIA" : vendor == "amd" ? "AMD" : "Intel"}`;
}

const FALLBACK_SOURCE: VideoStreamInfo = {width: 1920, height: 1080, frameRate: null};

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

export function sourceOrFallback(source: VideoStreamInfo | null) {
  return source ?? FALLBACK_SOURCE;
}

// Returns null when the size is unknown or not smaller than the source, so no scaling happens
export function scaledResolution(source: VideoStreamInfo | null, shortSide: number) {
  // Without the real size any fixed resolution could distort the picture
  if (!source) return null;
  const {width, height} = source;
  if (shortSide >= Math.min(width, height)) return null;
  const portrait = height > width;
  const ratio = portrait ? height / width : width / height;
  const longSide = even(shortSide * ratio);
  return portrait ? `${shortSide}x${longSide}` : `${longSide}x${shortSide}`;
}

export function heightForWidth(source: VideoStreamInfo | null, width: number) {
  const s = sourceOrFallback(source);
  return even((width * s.height) / s.width);
}

export function widthForHeight(source: VideoStreamInfo | null, height: number) {
  const s = sourceOrFallback(source);
  return even((height * s.width) / s.height);
}

export const STANDARD_SHORT_SIDES = [1080, 720, 480];
export const STANDARD_FRAME_RATES = [60, 30, 24];
export const AUDIO_BITRATE_KBPS = 128;
export const MAX_BITRATE_KBPS = 50000;
export const MAX_TARGET_SIZE_MB = 10000;
export const TARGET_SIZE_CHIPS_MB = [10, 25, 50, 100];
