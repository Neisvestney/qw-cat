import {observer} from "mobx-react-lite";
import React, {useContext, useEffect, useRef, useState} from "react";
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Slider,
  Stack,
  Step,
  StepButton,
  Stepper,
  styled,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import {css} from "@emotion/react";
import format from "format-duration";
import {save} from "@tauri-apps/plugin-dialog";
import FolderIcon from "@mui/icons-material/Folder";
import ForumIcon from "@mui/icons-material/Forum";
import HighQualityIcon from "@mui/icons-material/HighQuality";
import LanguageIcon from "@mui/icons-material/Language";
import BoltIcon from "@mui/icons-material/Bolt";
import TuneIcon from "@mui/icons-material/Tune";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import VideoEditorStore from "../stores/VideoEditorStore.ts";
import {
  codecDescription,
  codecFamily,
  codecLabel,
  codecShortLabel,
  CONTAINERS,
  ENCODERS,
  encoderLabel,
  encoderVendor,
  EXPORT_PRESETS,
  ExportPresetId,
  findExportPreset,
  heightForWidth,
  isCodecAvailable,
  isContainerCompatible,
  isVendorAvailable,
  resolvePresetCodec,
  scaledResolution,
  STANDARD_FRAME_RATES,
  STANDARD_SHORT_SIDES,
  MAX_BITRATE_KBPS,
  MAX_TARGET_SIZE_MB,
  TARGET_SIZE_CHIPS_MB,
  widthForHeight,
} from "../lib/exportPresets.ts";

const VIDEO_FORMATS = [
  "mp4",
  "m4v",
  "mov",
  "avi",
  "wmv",
  "flv",
  "f4v",
  "webm",
  "mkv",
  "mpg",
  "mpeg",
];

const STEPS = ["Purpose", "Video", "Audio & save"];

const PRESET_ICONS: Record<ExportPresetId | "custom", React.ReactNode> = {
  discord: <ForumIcon color="primary" />,
  hq: <HighQualityIcon color="primary" />,
  web: <LanguageIcon color="primary" />,
  fast: <BoltIcon color="primary" />,
  custom: <TuneIcon color="primary" />,
};

const OptionCardRoot = styled(ButtonBase, {
  shouldForwardProp: (prop) => prop !== "selected",
})<{selected: boolean}>(
  ({theme, selected}) => css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 2px;
    padding: 12px 14px;
    text-align: left;
    border-radius: ${theme.spacing(1)};
    border: 1px solid ${selected ? theme.palette.primary.main : theme.palette.divider};
    background-color: ${selected
      ? alpha(theme.palette.primary.main, 0.08)
      : theme.palette.action.hover};
    transition: border-color 150ms;

    &:hover {
      border-color: ${selected ? theme.palette.primary.main : theme.palette.text.secondary};
    }

    &.Mui-disabled {
      opacity: 0.45;
    }
  `,
);

interface OptionCardProps {
  title: string;
  description?: string;
  details?: string;
  icon?: React.ReactNode;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const OptionCard = observer(
  ({title, description, details, icon, selected, disabled, onClick}: OptionCardProps) => (
    <OptionCardRoot
      selected={selected}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
    >
      {icon}
      <Typography variant="subtitle2">{title}</Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
      {details && (
        <Typography variant="caption" color="text.disabled" sx={{fontFamily: "monospace"}}>
          {details}
        </Typography>
      )}
    </OptionCardRoot>
  ),
);

const CardGrid = observer(
  ({minWidth = 150, children}: {minWidth?: number; children: React.ReactNode}) => (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
        gap: 1.25,
      }}
    >
      {children}
    </Box>
  ),
);

const Section = observer(({label, children}: {label: string; children: React.ReactNode}) => (
  <Stack spacing={1}>
    <Typography variant="overline" color="text.secondary" sx={{lineHeight: 1.5}}>
      {label}
    </Typography>
    {children}
  </Stack>
));

const formatResolution = (resolution: string) => resolution.replace("x", "×");
const formatFps = (fps: number) => String(Number(fps.toFixed(2)));
const formatMbps = (kbps: number) => `${(kbps / 1000).toFixed(1)} Mbit/s`;

const ExportWizardDialog = observer(({open, onClose}: {open: boolean; onClose: () => void}) => {
  const appStateStore = useContext(AppStateStoreContext);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    appStateStore.loadHwEncoders().then((hwEncoders) => {
      const video = appStateStore.currentVideo;
      const lastPreset = findExportPreset(appStateStore.lastExportPreset);
      if (video && video.exportPreset == null && lastPreset) {
        video.applyExportPreset(lastPreset, hwEncoders, appStateStore.preferGpuEncoding);
      }
    });
  }, [open, appStateStore]);

  const video = appStateStore.currentVideo;
  if (!video) return null;

  const presetChosen = video.exportPreset != null;
  const skipVideoStep = presetChosen && video.exportPreset != "custom";

  const handleNext = () => setStep(step == 0 && skipVideoStep ? 2 : Math.min(2, step + 1));
  const handleBack = () => setStep(Math.max(0, step - 1));

  const handleExport = () => {
    const preset = findExportPreset(video.exportPreset);
    if (preset) appStateStore.setLastExportPreset(preset.id);
    onClose();
    video.exportVideo();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth={"md"} fullWidth>
      <DialogTitle sx={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
        Export video
        <Typography variant="caption" color="text.secondary" sx={{fontFamily: "monospace"}}>
          {video.estimatedVideoSizeMb != null && `≈ ${video.estimatedVideoSizeMb} MB · `}
          {format(video.trimDurationSeconds * 1000, {ms: true})}
        </Typography>
      </DialogTitle>
      <Stepper nonLinear activeStep={step} sx={{px: 3, pb: 2}}>
        {STEPS.map((label, i) => {
          const skipped = i == 1 && skipVideoStep && step != 1;
          return (
            <Step key={label} completed={i < step && !skipped} disabled={i > 0 && !presetChosen}>
              <StepButton
                onClick={() => setStep(i)}
                optional={
                  skipped ? (
                    <Typography variant="caption" color="text.secondary">
                      From preset
                    </Typography>
                  ) : undefined
                }
              >
                {label}
              </StepButton>
            </Step>
          );
        })}
      </Stepper>
      <DialogContent sx={{pt: 0}}>
        {step == 0 && (
          <PurposeStep video={video} onPresetPicked={(custom) => setStep(custom ? 1 : 2)} />
        )}
        {step == 1 && <VideoStep video={video} />}
        {step == 2 && <SaveStep video={video} onEditVideo={() => setStep(1)} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Box sx={{flex: 1}} />
        <Button onClick={handleBack} disabled={step == 0}>
          Back
        </Button>
        {step < 2 ? (
          <Button variant="contained" onClick={handleNext} disabled={!presetChosen}>
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleExport}
            disabled={!video.exportPath || !video.exportContainerCompatible}
          >
            Export video
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});

const PurposeStep = observer(
  ({
    video,
    onPresetPicked,
  }: {
    video: VideoEditorStore;
    onPresetPicked: (custom: boolean) => void;
  }) => {
    const appStateStore = useContext(AppStateStoreContext);
    const hwEncoders = appStateStore.hwEncoders ?? [];
    const preferGpu = appStateStore.preferGpuEncoding;
    const hasGpu = hwEncoders.length > 0;

    const handlePreferGpuChange = (checked: boolean) => {
      appStateStore.setPreferGpuEncoding(checked);
      const preset = findExportPreset(video.exportPreset);
      if (preset) video.applyExportPreset(preset, hwEncoders, checked);
    };

    return (
      <Stack spacing={2}>
        <Section label="What is this clip for?">
          <CardGrid minWidth={200}>
            {EXPORT_PRESETS.map((preset) => {
              const codec = resolvePresetCodec(preset, hwEncoders, preferGpu);
              const detecting = appStateStore.hwEncoders == null && preset.gpu == "required";
              return (
                <OptionCard
                  key={preset.id}
                  icon={PRESET_ICONS[preset.id]}
                  title={preset.title}
                  description={
                    codec
                      ? preset.description
                      : detecting
                        ? "Detecting GPU…"
                        : "Needs an NVIDIA, AMD or Intel GPU"
                  }
                  details={codec ? `${codecShortLabel(codec)} · ${preset.details}` : undefined}
                  selected={video.exportPreset == preset.id}
                  disabled={!codec}
                  onClick={() => {
                    video.applyExportPreset(preset, hwEncoders, preferGpu);
                    onPresetPicked(false);
                  }}
                />
              );
            })}
            <OptionCard
              icon={PRESET_ICONS.custom}
              title="Custom"
              description="Pick every setting yourself"
              selected={video.exportPreset == "custom"}
              onClick={() => {
                video.setExportPreset("custom");
                onPresetPicked(true);
              }}
            />
          </CardGrid>
        </Section>
        <FormControlLabel
          sx={{alignItems: "flex-start", mx: 0, gap: 1}}
          control={
            <Switch
              checked={preferGpu && hasGpu}
              disabled={!hasGpu}
              onChange={(e) => handlePreferGpuChange(e.target.checked)}
            />
          }
          label={
            <Stack sx={{pt: 1}}>
              <Typography variant="body2">Prefer GPU encoding</Typography>
              <Typography variant="caption" color="text.secondary">
                {hasGpu
                  ? "Use the GPU in every preset when it supports the codec. Faster, slightly lower quality at the same bitrate."
                  : "No supported GPU found on this PC."}
              </Typography>
            </Stack>
          }
        />
      </Stack>
    );
  },
);

const VideoStep = observer(({video}: {video: VideoEditorStore}) => {
  const appStateStore = useContext(AppStateStoreContext);
  const hwEncoders = appStateStore.hwEncoders ?? [];
  const codec = video.exportVideoEncoder;
  const vendor = encoderVendor(codec);
  const encoder = ENCODERS.find((e) => e.vendor == vendor)!;

  const exportSettings = () =>
    [
      video.exportVideoEncoder,
      video.exportFormat,
      video.exportResolution,
      video.exportFrameRate,
      video.exportBitrateKbps,
      video.exportTargetSizeMb,
    ].join("|");

  const edit = (change: () => void) => {
    const before = exportSettings();
    change();
    if (exportSettings() != before) video.setExportPreset("custom");
  };

  const handleVendorClick = (vendorCodecs: string[]) => {
    const available = vendorCodecs.filter((c) => isCodecAvailable(c, hwEncoders));
    const next = available.find((c) => codecFamily(c) == codecFamily(codec)) ?? available[0];
    if (next) edit(() => video.setExportCodec(next));
  };

  const sourceFps = video.sourceVideo?.frameRate ?? null;
  const frameRates = STANDARD_FRAME_RATES.filter(
    (fps) => sourceFps == null || fps < sourceFps - 0.5,
  );

  return (
    <Stack spacing={2.5}>
      <Section label="Encoder">
        <CardGrid minWidth={140}>
          {ENCODERS.map((e) => {
            const available = isVendorAvailable(e.vendor, hwEncoders);
            const description =
              e.vendor == "cpu"
                ? "Software, slower"
                : appStateStore.hwEncoders == null
                  ? "Detecting…"
                  : available
                    ? "Detected"
                    : "Not detected";
            return (
              <OptionCard
                key={e.vendor}
                title={e.label}
                description={description}
                selected={vendor == e.vendor}
                disabled={!available}
                onClick={() => handleVendorClick(e.codecs)}
              />
            );
          })}
        </CardGrid>
      </Section>
      <Section label="Codec">
        <CardGrid minWidth={140}>
          {encoder.codecs.map((c) => {
            const available = isCodecAvailable(c, hwEncoders);
            return (
              <OptionCard
                key={c}
                title={codecLabel(c)}
                description={available ? codecDescription(c) : "Not supported by this GPU"}
                details={c}
                selected={codec == c}
                disabled={!available}
                onClick={() => edit(() => video.setExportCodec(c))}
              />
            );
          })}
        </CardGrid>
      </Section>
      <Section label="Container">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={video.exportFormat}
          onChange={(_, value) => value && edit(() => video.setExportFormat(value))}
        >
          {CONTAINERS.map((container) => (
            <ToggleButton
              key={container}
              value={container}
              disabled={!isContainerCompatible(container, codec)}
              sx={{px: 2}}
            >
              {container}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Section>
      <ResolutionSection video={video} onEdit={edit} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 2.5,
        }}
      >
        <Section label="Frame rate">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={video.exportFrameRate ?? "source"}
            onChange={(_, value) =>
              value != null &&
              edit(() => video.setExportFrameRate(value == "source" ? null : value))
            }
          >
            <ToggleButton value="source" sx={{px: 2}}>
              {sourceFps ? `Source · ${formatFps(sourceFps)}` : "Source"}
            </ToggleButton>
            {frameRates.map((fps) => (
              <ToggleButton key={fps} value={fps} sx={{px: 2}}>
                {fps}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Section>
      </Box>
      <BitrateSection video={video} onEdit={edit} />
    </Stack>
  );
});

type BitrateMode = "auto" | "bitrate" | "size";

const MIN_SLIDER_KBPS = 500;
const sliderMaxFor = (kbps: number) => Math.min(MAX_BITRATE_KBPS, Math.max(20000, kbps));

const BitrateSection = observer(
  ({video, onEdit}: {video: VideoEditorStore; onEdit: (change: () => void) => void}) => {
    const mode: BitrateMode =
      video.exportTargetSizeMb != null
        ? "size"
        : video.exportBitrateKbps != null
          ? "bitrate"
          : "auto";
    const bitrate = video.effectiveBitrateKbps ?? 6000;

    // Fixed while dragging so the scale doesn't jump; recalculated when the mode changes
    const [sliderMax, setSliderMax] = useState(() => sliderMaxFor(bitrate));
    const [sizeText, setSizeText] = useState(String(video.exportTargetSizeMb ?? ""));

    const setTargetSize = (mb: number) => {
      setSizeText(String(mb));
      onEdit(() => video.setExportTargetSizeMb(mb));
    };

    const handleModeChange = (next: BitrateMode | null) => {
      if (!next || next == mode) return;
      if (next == "auto") onEdit(() => video.setExportBitrateKbps(null));
      if (next == "bitrate") {
        const kbps = Math.min(
          MAX_BITRATE_KBPS,
          Math.max(MIN_SLIDER_KBPS, Math.round(bitrate / 100) * 100),
        );
        setSliderMax(sliderMaxFor(kbps));
        onEdit(() => video.setExportBitrateKbps(kbps));
      }
      if (next == "size")
        setTargetSize(
          Math.min(MAX_TARGET_SIZE_MB, Math.max(1, Math.round(video.estimatedVideoSizeMb ?? 25))),
        );
    };

    const sizeValue = parseFloat(sizeText);
    const sizeValid = sizeValue >= 1 && sizeValue <= MAX_TARGET_SIZE_MB;

    const handleSizeTextChange = (text: string) => {
      setSizeText(text);
      const mb = parseFloat(text);
      if (mb >= 1 && mb <= MAX_TARGET_SIZE_MB) onEdit(() => video.setExportTargetSizeMb(mb));
    };

    const handleSizeBlur = () => {
      if (!sizeValid) setSizeText(String(video.exportTargetSizeMb ?? ""));
    };

    let caption: string;
    if (mode == "auto")
      caption = "The encoder picks the bitrate, so the file size can't be predicted";
    else if (mode == "bitrate") caption = `≈ ${video.estimatedVideoSizeMb} MB`;
    else if (!sizeValid) caption = `Enter a size from 1 to ${MAX_TARGET_SIZE_MB} MB`;
    else if (video.targetSizeUnreachable)
      caption = `Too long to fit ${video.exportTargetSizeMb} MB, expect ≈ ${video.estimatedVideoSizeMb} MB`;
    else caption = `${formatMbps(bitrate)} video · fits ${video.exportTargetSizeMb} MB`;

    return (
      <Section label="Bitrate">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          onChange={(_, value) => handleModeChange(value)}
        >
          <ToggleButton value="auto" sx={{px: 2}}>
            Auto
          </ToggleButton>
          <ToggleButton value="bitrate" sx={{px: 2}}>
            Bitrate
          </ToggleButton>
          <ToggleButton value="size" sx={{px: 2}}>
            File size
          </ToggleButton>
        </ToggleButtonGroup>
        {/* Both stay mounted so the closing one animates; spacing moves inside to avoid gaps while collapsed */}
        <Collapse in={mode == "bitrate"} sx={{mt: "0 !important"}}>
          <Stack direction="row" spacing={2} sx={{alignItems: "center", maxWidth: 560, pt: 1}}>
            <Slider
              min={MIN_SLIDER_KBPS}
              max={sliderMax}
              step={100}
              value={Math.min(Math.max(bitrate, MIN_SLIDER_KBPS), sliderMax)}
              onChange={(_, value) => onEdit(() => video.setExportBitrateKbps(value))}
            />
            <Typography variant="body2" sx={{fontFamily: "monospace", whiteSpace: "nowrap"}}>
              {formatMbps(bitrate)}
            </Typography>
          </Stack>
        </Collapse>
        <Collapse in={mode == "size"} sx={{mt: "0 !important"}}>
          <Stack
            direction="row"
            spacing={1}
            sx={{alignItems: "center", flexWrap: "wrap", rowGap: 1, pt: 1}}
          >
            <TextField
              size="small"
              type="number"
              label="File size"
              value={sizeText}
              onChange={(e) => handleSizeTextChange(e.target.value)}
              onBlur={handleSizeBlur}
              error={!sizeValid}
              sx={{width: 140}}
              slotProps={{
                htmlInput: {min: 1, max: MAX_TARGET_SIZE_MB, step: 1},
                input: {endAdornment: <InputAdornment position="end">MB</InputAdornment>},
              }}
            />
            {TARGET_SIZE_CHIPS_MB.map((mb) => (
              <Chip
                key={mb}
                label={`${mb} MB`}
                color={video.exportTargetSizeMb == mb ? "primary" : "default"}
                variant={video.exportTargetSizeMb == mb ? "filled" : "outlined"}
                onClick={() => setTargetSize(mb)}
              />
            ))}
          </Stack>
        </Collapse>
        <Typography
          variant="caption"
          color={
            mode == "size" && !sizeValid
              ? "error.main"
              : mode == "size" && video.targetSizeUnreachable
                ? "warning.main"
                : "text.secondary"
          }
        >
          {caption}
        </Typography>
      </Section>
    );
  },
);

const ResolutionSection = observer(
  ({video, onEdit}: {video: VideoEditorStore; onEdit: (change: () => void) => void}) => {
    const source = video.sourceVideo;
    const presets = STANDARD_SHORT_SIDES.map((side) => ({
      side,
      resolution: scaledResolution(source, side),
    })).filter((p): p is {side: number; resolution: string} => p.resolution != null);

    const isStandard =
      video.exportResolution == null || presets.some((p) => p.resolution == video.exportResolution);
    const [customOpen, setCustomOpen] = useState(!isStandard);
    const [lockAspect, setLockAspect] = useState(true);

    const sizeOf = (resolution: string | null) =>
      (resolution ?? `${source?.width ?? 1920}x${source?.height ?? 1080}`).split("x").map(Number);
    const [currentWidth, currentHeight] = sizeOf(video.exportResolution);
    const [width, setWidth] = useState(String(currentWidth));
    const [height, setHeight] = useState(String(currentHeight));

    const applyCustom = (w: string, h: string) => {
      setWidth(w);
      setHeight(h);
      const [wn, hn] = [parseInt(w), parseInt(h)];
      if (wn >= 16 && hn >= 16)
        onEdit(() => video.setExportResolution(`${wn + (wn % 2)}x${hn + (hn % 2)}`));
    };

    const selectStandard = (resolution: string | null) => {
      setCustomOpen(false);
      const [w, h] = sizeOf(resolution);
      setWidth(String(w));
      setHeight(String(h));
      onEdit(() => video.setExportResolution(resolution));
    };

    const handleWidthChange = (w: string) =>
      applyCustom(
        w,
        lockAspect && parseInt(w) > 0 ? String(heightForWidth(source, parseInt(w))) : height,
      );
    const handleHeightChange = (h: string) =>
      applyCustom(
        lockAspect && parseInt(h) > 0 ? String(widthForHeight(source, parseInt(h))) : width,
        h,
      );

    const wn = parseInt(width);
    const hn = parseInt(height);
    const warnings: string[] = [];
    if (wn % 2 || hn % 2)
      warnings.push(`Odd sizes will be rounded to ${wn + (wn % 2)}×${hn + (hn % 2)}`);
    if (source && (wn > source.width || hn > source.height))
      warnings.push(
        `Larger than the source ${source.width}×${source.height}, upscaling adds no detail`,
      );
    if (!lockAspect && source && Math.abs(wn / hn - source.width / source.height) > 0.01)
      warnings.push("Aspect ratio differs from the source, the picture will be stretched");

    // Keeps the last warnings on screen while the Collapse closes, so it animates instead of snapping
    const shownWarnings = useRef(warnings);
    if (warnings.length > 0) shownWarnings.current = warnings;

    return (
      <Section label="Resolution">
        <CardGrid minWidth={120}>
          <OptionCard
            title="Source"
            details={source ? `${source.width}×${source.height}` : "Original"}
            selected={!customOpen && video.exportResolution == null}
            onClick={() => selectStandard(null)}
          />
          {presets.map((p) => (
            <OptionCard
              key={p.side}
              title={`${p.side}p`}
              details={formatResolution(p.resolution)}
              selected={!customOpen && video.exportResolution == p.resolution}
              onClick={() => selectStandard(p.resolution)}
            />
          ))}
          <OptionCard
            title="Custom"
            details={
              customOpen && video.exportResolution
                ? formatResolution(video.exportResolution)
                : "Any size"
            }
            selected={customOpen}
            onClick={() => {
              setCustomOpen(true);
              const [w, h] = sizeOf(video.exportResolution);
              setWidth(String(w));
              setHeight(String(h));
            }}
          />
        </CardGrid>
        {/* Section's Stack spacing would leave a gap while collapsed, so spacing moves inside */}
        <Collapse in={customOpen} sx={{mt: "0 !important"}}>
          <Stack direction="row" spacing={1} sx={{alignItems: "center", pt: 1.5}}>
            <TextField
              size="small"
              type="number"
              label="Width"
              value={width}
              onChange={(e) => handleWidthChange(e.target.value)}
              sx={{width: 120}}
            />
            <Typography color="text.secondary">×</Typography>
            <TextField
              size="small"
              type="number"
              label="Height"
              value={height}
              onChange={(e) => handleHeightChange(e.target.value)}
              sx={{width: 120}}
            />
            <Tooltip title={lockAspect ? "Aspect ratio locked to the source" : "Free aspect ratio"}>
              <IconButton
                color={lockAspect ? "primary" : "default"}
                onClick={() => {
                  const lock = !lockAspect;
                  setLockAspect(lock);
                  if (lock && wn > 0) applyCustom(width, String(heightForWidth(source, wn)));
                }}
              >
                {lockAspect ? <LinkIcon /> : <LinkOffIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Collapse in={warnings.length > 0}>
            <Stack sx={{pt: 1}}>
              {shownWarnings.current.map((warning) => (
                <Typography key={warning} variant="caption" color="warning.main">
                  {warning}
                </Typography>
              ))}
            </Stack>
          </Collapse>
        </Collapse>
      </Section>
    );
  },
);

const SaveStep = observer(
  ({video, onEditVideo}: {video: VideoEditorStore; onEditVideo: () => void}) => {
    const preset = findExportPreset(video.exportPreset);
    const codec = video.exportVideoEncoder;
    const source = video.sourceVideo;

    const handleSelectExportPath = async () => {
      const path = await save({
        defaultPath: video.exportPath,
        filters: [
          {name: "Video", extensions: VIDEO_FORMATS},
          {name: "All", extensions: ["*"]},
        ],
      });
      if (path) video.setExportPath(path);
    };

    const resolution = video.exportResolution
      ? formatResolution(video.exportResolution)
      : source
        ? `${source.width}×${source.height}`
        : "source resolution";
    const fps =
      video.exportFrameRate ?? (source?.frameRate ? formatFps(source.frameRate) : "source");
    const bitrate = video.effectiveBitrateKbps
      ? formatMbps(video.effectiveBitrateKbps)
      : "auto bitrate";

    const summary: [string, React.ReactNode][] = [
      ["Preset", preset?.title ?? "Custom"],
      ["Encoder", encoderLabel(encoderVendor(codec))],
      [
        "Video",
        <>
          {[codec ?? "default codec", resolution, `${fps} fps`, bitrate].join(" · ")}
          <Button size="small" sx={{ml: 1, minWidth: 0, py: 0}} onClick={onEditVideo}>
            Edit
          </Button>
        </>,
      ],
      [
        "Size",
        video.estimatedVideoSizeMb != null
          ? `≈ ${video.estimatedVideoSizeMb} MB`
          : "depends on the encoder",
      ],
    ];

    return (
      <Stack spacing={2.5}>
        <Section label="Audio tracks">
          {video.audioStreams.length == 0 && (
            <Typography variant="body2" color="text.secondary">
              This video has no audio tracks.
            </Typography>
          )}
          {video.audioStreams.map((audioStream, index) => (
            <FormControlLabel
              key={audioStream.streamIndex}
              control={
                <Switch
                  checked={audioStream.active}
                  onChange={() => video.toggleAudioStream(audioStream.streamIndex)}
                />
              }
              label={`Audio stream #${index + 1}`}
            />
          ))}
        </Section>
        <Section label="Save to">
          <TextField
            required
            fullWidth
            value={video.exportPath}
            onChange={(e) => video.setExportPath(e.target.value)}
            error={!video.exportContainerCompatible}
            helperText={
              !video.exportContainerCompatible &&
              `${video.exportFormat} can't hold ${codecLabel(video.exportVideoEncoder ?? "")} video. Change the file extension or pick another codec on the Video step.`
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleSelectExportPath} edge="end">
                      <FolderIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Section>
        <Section label="Summary">
          <Box sx={{display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.5}}>
            {summary.map(([label, value]) => (
              <React.Fragment key={label}>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{fontFamily: "monospace", overflowWrap: "anywhere"}}
                >
                  {value}
                </Typography>
              </React.Fragment>
            ))}
          </Box>
        </Section>
      </Stack>
    );
  },
);

export default ExportWizardDialog;
