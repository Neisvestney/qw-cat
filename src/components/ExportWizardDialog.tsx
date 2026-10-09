import {observer} from "mobx-react-lite";
import React, {useCallback, useContext, useEffect, useLayoutEffect, useRef, useState} from "react";
import {
  AnimatePresence,
  animate,
  AnimationPlaybackControls,
  motion,
  MotionConfig,
  Transition,
  useSpring,
  useTransform,
  Variants,
} from "motion/react";
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
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
import SendIcon from "@mui/icons-material/Send";
import CompressIcon from "@mui/icons-material/Compress";
import MovieEditIcon from "@mui/icons-material/MovieEdit";
import GifBoxIcon from "@mui/icons-material/GifBox";
import TuneIcon from "@mui/icons-material/Tune";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import VideoEditorStore from "../stores/VideoEditorStore.ts";
import {
  AUDIO_BITRATES_KBPS,
  AUDIO_CODECS,
  audioCodecDescription,
  audioCodecLabel,
  codecDescription,
  codecFamily,
  codecLabel,
  codecShortLabel,
  CONTAINERS,
  ENCODERS,
  encoderLabel,
  encoderVendor,
  ExportPreset,
  findExportPreset,
  hasAudio,
  hasGpuEncoder,
  heightForWidth,
  isAudioCodecCompatible,
  isLosslessAudio,
  isCodecAvailable,
  isContainerCompatible,
  isVendorAvailable,
  resolvedAudioCodecLabel,
  resolvePresetCodec,
  scaledResolution,
  STANDARD_FRAME_RATES,
  STANDARD_SHORT_SIDES,
  supportsBitrate,
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
  "gif",
  "webp",
];

const STEPS = ["Purpose", "Video", "Audio & save"];

const PRESET_ICONS: Record<string, React.ReactNode> = {
  discord: <ForumIcon color="primary" />,
  messenger: <SendIcon color="primary" />,
  hq: <HighQualityIcon color="primary" />,
  small: <CompressIcon color="primary" />,
  web: <LanguageIcon color="primary" />,
  editing: <MovieEditIcon color="primary" />,
  gif: <GifBoxIcon color="primary" />,
  fast: <BoltIcon color="primary" />,
  custom: <TuneIcon color="primary" />,
};

const CUSTOM_PRESET_ICON = <BookmarkIcon color="primary" />;

// Above the wizard dialog
const OVER_WIZARD_Z_INDEX = 1456;

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
    transition:
      border-color 150ms,
      background-color 150ms;

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
  // Kept outside the card, a button can't hold another button
  action?: React.ReactNode;
}

const OptionCard = observer((props: OptionCardProps) => {
  if (!props.action) return <OptionCardContent {...props} />;
  return (
    <Box sx={{position: "relative", height: "100%"}}>
      <OptionCardContent {...props} />
      <Box sx={{position: "absolute", top: 6, right: 6}}>{props.action}</Box>
    </Box>
  );
});

const OptionCardContent = observer(
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
          <FadeText text={description} />
        </Typography>
      )}
      {details && (
        <Typography variant="caption" color="text.disabled" sx={{fontFamily: "monospace"}}>
          <FadeText text={details} />
        </Typography>
      )}
    </OptionCardRoot>
  ),
);

const CardGrid = observer(
  ({minWidth = 150, children}: {minWidth?: number; children: React.ReactNode}) => (
    <Box
      sx={{
        position: "relative",
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

const TRANSITION: Transition = {duration: 0.25, ease: [0.4, 0, 0.2, 1]};

const stepVariants: Variants = {
  enter: (direction: number) => ({x: `${direction * 30}%`, opacity: 0}),
  center: {x: 0, opacity: 1, pointerEvents: "auto"},
  // The leaving step's handlers close over the old step, so clicks on it must not go through
  exit: (direction: number) => ({x: `${direction * -30}%`, opacity: 0, pointerEvents: "none"}),
};

const cardPresence = {
  initial: {opacity: 0, scale: 0.92},
  animate: {opacity: 1, scale: 1},
  exit: {opacity: 0, scale: 0.92},
};

// Without `trigger` every size change animates. With it only changes caused by a new trigger value do,
// otherwise it stays auto so animations inside aren't chased frame by frame
const AnimatedHeight = observer(
  ({trigger, children}: {trigger?: unknown; children: React.ReactNode}) => {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const lastHeight = useRef(0);
    const target = useRef<number | null>(null);
    const controls = useRef<AnimationPlaybackControls | null>(null);
    const alwaysAnimate = trigger === undefined;

    const animateTo = useCallback((to: number) => {
      if (to == (target.current ?? lastHeight.current)) return;
      const outer = outerRef.current!;
      const from =
        target.current == null ? lastHeight.current : outer.getBoundingClientRect().height;
      target.current = to;
      controls.current?.stop();
      // Set synchronously so the new content's height never paints for a frame before the animation starts
      outer.style.height = `${from}px`;
      // Clipped only while animating, otherwise it cuts off slider thumbs and focus rings
      outer.style.overflow = "hidden";
      controls.current = animate(
        outer,
        {height: [from, to]},
        {
          ...TRANSITION,
          onComplete: () => {
            if (target.current != to) return;
            target.current = null;
            outer.style.height = "";
            outer.style.overflow = "";
          },
        },
      );
    }, []);

    useLayoutEffect(() => {
      const inner = innerRef.current!;
      lastHeight.current = inner.offsetHeight;
      const observer = new ResizeObserver(() => {
        const height = inner.offsetHeight;
        if (alwaysAnimate || target.current != null) animateTo(height);
        lastHeight.current = height;
      });
      observer.observe(inner);
      return () => {
        observer.disconnect();
        controls.current?.stop();
      };
    }, [alwaysAnimate, animateTo]);

    useLayoutEffect(() => {
      if (!alwaysAnimate) animateTo(innerRef.current!.offsetHeight);
    }, [trigger, alwaysAnimate, animateTo]);

    return (
      <div ref={outerRef}>
        <div ref={innerRef} style={{position: "relative", display: "flow-root"}}>
          {children}
        </div>
      </div>
    );
  },
);

// Stack spacing would leave a gap while hidden, so the margin is reset inline and the gap moves inside
const Reveal = observer(
  ({show, gap = 1, children}: {show: boolean; gap?: number; children: React.ReactNode}) => (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="reveal"
          initial={{height: 0, opacity: 0, overflow: "hidden"}}
          animate={{height: "auto", opacity: 1, transitionEnd: {overflow: "visible"}}}
          exit={{height: 0, opacity: 0, overflow: "hidden"}}
          style={{marginTop: 0}}
        >
          <Box sx={{pt: gap}}>{children}</Box>
        </motion.div>
      )}
    </AnimatePresence>
  ),
);

const FadeText = observer(({text}: {text: string}) => (
  <AnimatePresence mode="wait" initial={false}>
    <motion.span
      key={text}
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      transition={{duration: 0.12}}
    >
      {text}
    </motion.span>
  </AnimatePresence>
));

const AnimatedNumber = observer(({value}: {value: number}) => {
  const spring = useSpring(value, {visualDuration: 0.35, bounce: 0});
  const rounded = useTransform(spring, (v) => Math.round(v));
  useEffect(() => spring.set(value), [spring, value]);
  return <motion.span>{rounded}</motion.span>;
});

const formatResolution = (resolution: string) => resolution.replace("x", "×");
const formatFps = (fps: number) => String(Number(fps.toFixed(2)));
const formatMbps = (kbps: number) => `${(kbps / 1000).toFixed(1)} Mbit/s`;

const ExportWizardDialog = observer(({open, onClose}: {open: boolean; onClose: () => void}) => {
  const appStateStore = useContext(AppStateStoreContext);
  const [[step, direction], setStepState] = useState([0, 1]);

  useEffect(() => {
    if (!open) return;
    appStateStore.loadHwEncoders().then((hwEncoders) => {
      const video = appStateStore.currentVideo;
      const lastPreset = findExportPreset(
        appStateStore.lastExportPreset,
        appStateStore.exportPresets,
      );
      if (video && video.exportPreset == null && lastPreset) {
        video.applyExportPreset(lastPreset, hwEncoders, appStateStore.preferGpuEncoding);
      }
    });
  }, [open, appStateStore]);

  const video = appStateStore.currentVideo;
  if (!video) return null;

  const presetChosen = video.exportPreset != null;
  const skipVideoStep = presetChosen && video.exportPreset != "custom";

  const setStep = (next: number) => setStepState([next, next > step ? 1 : -1]);
  const handleNext = () => setStep(step == 0 && skipVideoStep ? 2 : Math.min(2, step + 1));
  const handleBack = () => setStep(Math.max(0, step - 1));

  const handleExport = () => {
    const preset = findExportPreset(video.exportPreset, appStateStore.exportPresets);
    if (preset) appStateStore.setLastExportPreset(preset.id);
    onClose();
    video.exportVideo();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={"md"}
      fullWidth
      sx={{zIndex: 1455}}
      // Reset once hidden, so reopening doesn't animate from the last step
      slotProps={{transition: {onExited: () => setStepState([0, 1])}}}
    >
      <MotionConfig reducedMotion="user" transition={TRANSITION}>
        <DialogTitle
          sx={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}
        >
          Export video
          <Typography variant="caption" color="text.secondary" sx={{fontFamily: "monospace"}}>
            {video.estimatedVideoSizeMb != null && (
              <>
                ≈ <AnimatedNumber value={video.estimatedVideoSizeMb} /> MB ·{" "}
              </>
            )}
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
        {/* Clips the sliding steps when their heights match and AnimatedHeight doesn't clip */}
        <DialogContent sx={{pt: 0, overflowX: "hidden"}}>
          <AnimatedHeight trigger={step}>
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {step == 0 && (
                  <PurposeStep video={video} onPresetPicked={(custom) => setStep(custom ? 1 : 2)} />
                )}
                {step == 1 && <VideoStep video={video} />}
                {step == 2 && <SaveStep video={video} onEditVideo={() => setStep(1)} />}
              </motion.div>
            </AnimatePresence>
          </AnimatedHeight>
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
      </MotionConfig>
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
    const hasGpu = hasGpuEncoder(hwEncoders);

    const handlePreferGpuChange = (checked: boolean) => {
      appStateStore.setPreferGpuEncoding(checked);
      const preset = findExportPreset(video.exportPreset, appStateStore.exportPresets);
      if (preset) video.applyExportPreset(preset, hwEncoders, checked);
    };

    return (
      <Stack spacing={2}>
        <Section label="What is this clip for?">
          <CardGrid minWidth={200}>
            {appStateStore.exportPresets.map((preset) => {
              const codec = resolvePresetCodec(preset, hwEncoders, preferGpu);
              const detecting = appStateStore.hwEncoders == null;
              return (
                <OptionCard
                  key={preset.id}
                  icon={preset.custom ? CUSTOM_PRESET_ICON : PRESET_ICONS[preset.id]}
                  title={preset.title}
                  description={
                    codec
                      ? preset.description
                      : detecting
                        ? "Detecting encoders…"
                        : preset.gpu == "required"
                          ? "Needs an NVIDIA, AMD or Intel GPU"
                          : "Not supported by this FFmpeg build"
                  }
                  details={codec ? `${codecShortLabel(codec)} · ${preset.details}` : undefined}
                  selected={video.exportPreset == preset.id}
                  disabled={!codec}
                  onClick={() => {
                    video.applyExportPreset(preset, hwEncoders, preferGpu);
                    onPresetPicked(false);
                  }}
                  action={preset.custom && <CustomPresetMenu preset={preset} />}
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
        <AnimatedHeight>
          <CardGrid minWidth={140}>
            {/* Keyed by family so H.264 & co. stay in place across vendors and only the extras come and go */}
            <AnimatePresence mode="popLayout" initial={false}>
              {encoder.codecs.map((c) => {
                const available = isCodecAvailable(c, hwEncoders);
                return (
                  <motion.div key={codecFamily(c)} {...cardPresence}>
                    <OptionCard
                      title={codecLabel(c)}
                      description={
                        available
                          ? codecDescription(c)
                          : vendor == "cpu"
                            ? "Not in this FFmpeg build"
                            : "Not supported by this GPU"
                      }
                      details={c}
                      selected={codec == c}
                      disabled={!available}
                      onClick={() => edit(() => video.setExportCodec(c))}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </CardGrid>
        </AnimatedHeight>
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
      <Reveal show={supportsBitrate(codec)} gap={2.5}>
        <BitrateSection video={video} onEdit={edit} />
      </Reveal>
    </Stack>
  );
});

type BitrateMode = "auto" | "bitrate" | "size";

const MIN_SLIDER_KBPS = 500;
const sliderMaxFor = (kbps: number) => Math.min(MAX_BITRATE_KBPS, Math.max(20000, kbps));
const formatMbpsValue = (kbps: number) => (kbps / 1000).toFixed(1);

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
    const [bitrateText, setBitrateText] = useState(() => formatMbpsValue(bitrate));

    const setBitrate = (kbps: number) => {
      setBitrateText(formatMbpsValue(kbps));
      onEdit(() => video.setExportBitrateKbps(kbps));
    };

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
        setBitrate(kbps);
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

    // Rounded to the slider step, so the normalized text on blur matches what's stored
    const parseKbps = (text: string) => Math.round(parseFloat(text) * 10) * 100;
    const isKbpsValid = (kbps: number) => kbps >= MIN_SLIDER_KBPS && kbps <= MAX_BITRATE_KBPS;
    const bitrateValid = isKbpsValid(parseKbps(bitrateText));

    const handleBitrateTextChange = (text: string) => {
      setBitrateText(text);
      const kbps = parseKbps(text);
      if (isKbpsValid(kbps)) onEdit(() => video.setExportBitrateKbps(kbps));
    };

    // The scale is refitted here rather than per keystroke, so typing "25" via "2" doesn't stretch it for good
    const handleBitrateBlur = () => {
      setBitrateText(formatMbpsValue(bitrate));
      setSliderMax(sliderMaxFor(bitrate));
    };

    let caption: string;
    if (mode == "auto")
      caption = "The encoder picks the bitrate, so the file size can't be predicted";
    else if (mode == "bitrate" && !bitrateValid)
      caption = `Enter a bitrate from ${formatMbpsValue(MIN_SLIDER_KBPS)} to ${formatMbpsValue(MAX_BITRATE_KBPS)} Mbit/s`;
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
        <Reveal show={mode == "bitrate"}>
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{alignItems: "center", flexWrap: "wrap", rowGap: 1, maxWidth: 560}}
          >
            <Slider
              sx={{flex: "1 1 120px"}}
              min={MIN_SLIDER_KBPS}
              max={sliderMax}
              step={100}
              value={Math.min(Math.max(bitrate, MIN_SLIDER_KBPS), sliderMax)}
              onChange={(_, value) => setBitrate(value)}
            />
            <TextField
              size="small"
              type="number"
              label="Bitrate"
              value={bitrateText}
              onChange={(e) => handleBitrateTextChange(e.target.value)}
              onBlur={handleBitrateBlur}
              error={!bitrateValid}
              sx={{width: 150, flexShrink: 0}}
              slotProps={{
                htmlInput: {
                  min: MIN_SLIDER_KBPS / 1000,
                  max: MAX_BITRATE_KBPS / 1000,
                  step: 0.1,
                },
                input: {endAdornment: <InputAdornment position="end">Mbit/s</InputAdornment>},
              }}
            />
          </Stack>
        </Reveal>
        <Reveal show={mode == "size"}>
          <Stack
            direction="row"
            spacing={1}
            sx={{alignItems: "center", flexWrap: "wrap", rowGap: 1}}
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
        </Reveal>
        <Typography
          variant="caption"
          color={
            (mode == "size" && !sizeValid) || (mode == "bitrate" && !bitrateValid)
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
        <Reveal show={customOpen} gap={1.5}>
          <Stack direction="row" spacing={1} sx={{alignItems: "center"}}>
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
          <Reveal show={warnings.length > 0}>
            <Stack>
              {warnings.map((warning) => (
                <Typography key={warning} variant="caption" color="warning.main">
                  {warning}
                </Typography>
              ))}
            </Stack>
          </Reveal>
        </Reveal>
      </Section>
    );
  },
);

const formatChannels = (channels: number | null) =>
  channels == null
    ? null
    : (({1: "mono", 2: "stereo", 6: "5.1", 8: "7.1"} as Record<number, string>)[channels] ??
      `${channels} ch`);

const AudioBitrateSelect = observer(
  ({
    value,
    sourceKbps,
    lossless,
    disabled,
    onChange,
  }: {
    value: number;
    sourceKbps: number | null;
    lossless: boolean;
    disabled?: boolean;
    onChange: (kbps: number) => void;
  }) => (
    <TextField
      select
      size="small"
      value={lossless ? "lossless" : value}
      disabled={disabled || lossless}
      onChange={(e) => onChange(Number(e.target.value))}
      sx={{minWidth: 120}}
      slotProps={{
        select: {
          renderValue: (v) => (v == "lossless" ? "Lossless" : `${String(v)} kbps`),
          // The wizard dialog sits above MUI's default modal layer
          MenuProps: {sx: {zIndex: 1456}},
        },
      }}
    >
      {lossless ? (
        <MenuItem value="lossless">Lossless</MenuItem>
      ) : (
        AUDIO_BITRATES_KBPS.map((kbps) => (
          <MenuItem key={kbps} value={kbps}>
            {kbps} kbps
            {sourceKbps != null && kbps > sourceKbps && (
              <Typography component="span" variant="caption" color="text.disabled" sx={{ml: 1}}>
                above source
              </Typography>
            )}
          </MenuItem>
        ))
      )}
    </TextField>
  ),
);

const AudioSection = observer(({video}: {video: VideoEditorStore}) => {
  const [expanded, setExpanded] = useState(video.exportPreset == "custom");
  const codec = video.exportVideoEncoder;
  const container = video.exportFormat;
  const audioCodec = video.exportAudioCodec;
  const lossless = isLosslessAudio(audioCodec);
  const multiple = video.audioStreams.length > 1;
  const separate = multiple && !video.exportMixAudio;

  const edit = (change: () => void) => {
    change();
    if (video.exportPreset != null) video.setExportPreset("custom");
  };

  if (!hasAudio(codec))
    return (
      <Section label="Audio">
        <Typography variant="body2" color="text.secondary">
          {codecLabel(codec ?? "")} has no sound, audio tracks are skipped.
        </Typography>
      </Section>
    );

  if (video.audioStreams.length == 0)
    return (
      <Section label="Audio">
        <Typography variant="body2" color="text.secondary">
          This video has no audio tracks.
        </Typography>
      </Section>
    );

  const activeBitrates = video.activeAudioStreams.map((s) => s.bitrateKbps);
  const bitrateSummary = lossless
    ? "lossless"
    : separate && activeBitrates.length
      ? `${activeBitrates.join(" + ")} kbps`
      : `${video.exportAudioBitrateKbps} kbps`;
  const summary = [
    resolvedAudioCodecLabel(audioCodec, container),
    bitrateSummary,
    multiple && (separate ? "separate tracks" : "mixed into one"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Section label="Audio">
      <Reveal show={!expanded}>
        <Typography variant="body2" sx={{fontFamily: "monospace"}}>
          {summary}
          <Button size="small" sx={{ml: 1, minWidth: 0, py: 0}} onClick={() => setExpanded(true)}>
            Change
          </Button>
        </Typography>
      </Reveal>
      <Reveal show={expanded}>
        <Stack spacing={1.5}>
          <Stack spacing={0.5}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={audioCodec}
              onChange={(_, value) => value && edit(() => video.setExportAudioCodec(value))}
            >
              {AUDIO_CODECS.map((c) => (
                <ToggleButton
                  key={c}
                  value={c}
                  disabled={!isAudioCodecCompatible(container, c)}
                  sx={{px: 2}}
                >
                  {audioCodecLabel(c)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              <FadeText text={audioCodecDescription(audioCodec, container)} />
            </Typography>
          </Stack>
          {multiple && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={video.exportMixAudio}
              onChange={(_, value) => value != null && edit(() => video.setExportMixAudio(value))}
            >
              <ToggleButton value={true} sx={{px: 2}}>
                Mix into one
              </ToggleButton>
              <ToggleButton value={false} sx={{px: 2}}>
                Keep separate
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          <Reveal show={!separate} gap={1.5}>
            <Stack direction="row" spacing={1.5} sx={{alignItems: "center"}}>
              <Typography variant="body2" color="text.secondary">
                Bitrate
              </Typography>
              <AudioBitrateSelect
                value={video.exportAudioBitrateKbps}
                sourceKbps={null}
                lossless={lossless}
                onChange={(kbps) => edit(() => video.setExportAudioBitrateKbps(kbps))}
              />
            </Stack>
          </Reveal>
        </Stack>
      </Reveal>
      {video.audioStreams.map((audioStream, index) => (
        <Stack
          key={audioStream.streamIndex}
          direction="row"
          spacing={1}
          // Matches the select's height so rows don't jump when it appears
          sx={{alignItems: "center", justifyContent: "space-between", minHeight: 40}}
        >
          <FormControlLabel
            control={
              <Switch
                checked={audioStream.active}
                onChange={() => video.toggleAudioStream(audioStream.streamIndex)}
              />
            }
            label={
              <>
                Audio stream #{index + 1}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.disabled"
                  sx={{ml: 1, fontFamily: "monospace"}}
                >
                  {[
                    audioStream.codecName,
                    formatChannels(audioStream.channels),
                    audioStream.sourceBitrateKbps && `${audioStream.sourceBitrateKbps} kbps`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              </>
            }
          />
          <AnimatePresence initial={false}>
            {expanded && separate && (
              <motion.div key="bitrate" {...cardPresence}>
                <AudioBitrateSelect
                  value={audioStream.bitrateKbps}
                  sourceKbps={audioStream.sourceBitrateKbps}
                  lossless={lossless}
                  disabled={!audioStream.active}
                  onChange={(kbps) =>
                    edit(() => video.setAudioStreamBitrate(audioStream.streamIndex, kbps))
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
        </Stack>
      ))}
    </Section>
  );
});

const PresetNameDialog = observer(
  ({
    open,
    title,
    initialName,
    submitLabel,
    onClose,
    onSubmit,
  }: {
    open: boolean;
    title: string;
    initialName: string;
    submitLabel: string;
    onClose: () => void;
    onSubmit: (name: string) => void;
  }) => {
    const [name, setName] = useState(initialName);
    const trimmed = name.trim();

    const submit = () => {
      if (!trimmed) return;
      onSubmit(trimmed);
      onClose();
    };

    return (
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xs"
        fullWidth
        sx={{zIndex: OVER_WIZARD_Z_INDEX}}
        slotProps={{transition: {onEnter: () => setName(initialName)}}}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key == "Enter" && submit()}
            slotProps={{htmlInput: {maxLength: 60}}}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={!trimmed}>
            {submitLabel}
          </Button>
        </DialogActions>
      </Dialog>
    );
  },
);

const CustomPresetMenu = observer(({preset}: {preset: ExportPreset}) => {
  const appStateStore = useContext(AppStateStoreContext);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);

  return (
    <>
      <IconButton
        size="small"
        aria-label="Preset actions"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor != null}
        onClose={() => setAnchor(null)}
        sx={{zIndex: OVER_WIZARD_Z_INDEX}}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setRenaming(true);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            appStateStore.deleteCustomExportPreset(preset.id);
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      <PresetNameDialog
        open={renaming}
        title="Rename preset"
        initialName={preset.title}
        submitLabel="Rename"
        onClose={() => setRenaming(false)}
        onSubmit={(name) => appStateStore.renameCustomExportPreset(preset.id, name)}
      />
    </>
  );
});

const SaveStep = observer(
  ({video, onEditVideo}: {video: VideoEditorStore; onEditVideo: () => void}) => {
    const appStateStore = useContext(AppStateStoreContext);
    const preset = findExportPreset(video.exportPreset, appStateStore.exportPresets);
    const codec = video.exportVideoEncoder;
    const source = video.sourceVideo;
    const [savingPreset, setSavingPreset] = useState(false);

    const handleSavePreset = (name: string) => {
      const custom = video.toCustomExportPreset(name);
      if (!custom) return;
      appStateStore.addCustomExportPreset(custom);
      video.setExportPreset(custom.id);
    };

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
      [
        "Preset",
        <>
          {preset?.title ?? "Custom"}
          {!preset && (
            <Button
              size="small"
              sx={{ml: 1, minWidth: 0, py: 0}}
              disabled={!codecFamily(codec)}
              onClick={() => setSavingPreset(true)}
            >
              Save as preset
            </Button>
          )}
        </>,
      ],
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
        <AudioSection video={video} />
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
        <PresetNameDialog
          open={savingPreset}
          title="Save as preset"
          initialName={`${codecLabel(codec ?? "")} ${video.exportFormat}`}
          submitLabel="Save"
          onClose={() => setSavingPreset(false)}
          onSubmit={handleSavePreset}
        />
      </Stack>
    );
  },
);

export default ExportWizardDialog;
