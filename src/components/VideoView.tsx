import {observer} from "mobx-react-lite";
import React, {ChangeEvent, CSSProperties, useContext, useEffect, useRef, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Button,
  Slider,
  Stack,
  styled,
  Dialog,
  DialogTitle,
  DialogActions,
  DialogContent,
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  InputAdornment,
  IconButton,
  Grid,
  MenuItem,
  Autocomplete,
  InputLabel, Select, FormControl,
  Input, SliderThumb, Box, Avatar, ToggleButton, Tooltip,
} from "@mui/material";
import {css} from '@emotion/react';
import {convertFileSrc} from "@tauri-apps/api/core";
import format from 'format-duration';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {autorun} from "mobx";
import {useSyncedMediaTracks} from "../lib/useSyncedMediaTracks.ts";
import FolderIcon from "@mui/icons-material/Folder";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import PauseCircleIcon from "@mui/icons-material/PauseCircle";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import {save} from "@tauri-apps/plugin-dialog";
import {GpuAcceleration} from "../generated";
import ReplayIcon from "@mui/icons-material/Replay";
import {VolumeDown, VolumeUp} from "@mui/icons-material";
import {AudioStream} from "../stores/VideoEditorStore.ts";
import {useDebouncedCallback, useThrottledCallback} from "use-debounce";
import {gainToGainValue, useVideoGain} from "../lib/useVideoGain.ts";

const ViewContainer = styled('div')(
  ({theme}) => css`
      flex: 1;
      display: flex;
      flex-direction: column;
  `,
);


const VideoContainer = styled('div')(
  ({theme}) => css`
      background-color: ${theme.palette.grey["900"]};
      flex: 1;
      position: relative;
  `,
);

const VideoWrapper = styled('div')(
  ({theme}) => css`
      position: absolute;
      display: flex;
      justify-content: center;
      top: 0;
      bottom: 0;
      right: 0;
      left: 0;
  `,
);

// noinspection CssInvalidPseudoSelector
const Video = styled('video')(
  ({theme}) => css`
      max-width: 100%;
      max-height: 100%;
      
      &::-webkit-media-controls-enclosure {
          display:none !important;
      }
      
      &::-webkit-media-controls {
          display:none !important;
      }
  `,
);

interface VideoOverlayControlsWrapperProps {
  align?: CSSProperties["alignItems"];
}

const VideoOverlayControlsWrapper = styled('div')<VideoOverlayControlsWrapperProps>(
  ({theme, align}) => css`
      z-index: 2147483647;
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      left: 0;
      
      pointer-events: none;
      
      display: flex;
      align-items: ${align ?? "end"};
      justify-content: center;
  `,
);

const VideoOverlayControls = styled('div')(
  ({theme}) => css`
      width: 100%;
      position: relative;
      background: linear-gradient(
              to top,
              rgba(0, 0, 0, 0.9) 0%,
              rgba(0, 0, 0, 0.4) 100%
      );

      pointer-events: auto;

      &::before {
          content: "";
          position: absolute;
          top: -48px;
          left: 0;
          right: 0;
          height: 48px;
          background: linear-gradient(
                  to top,
                  rgba(0, 0, 0, 0.4),
                  rgba(0, 0, 0, 0)
          );
          //pointer-events: none;
      }

      transition: opacity 0.3s;
      opacity: 0;
      &:hover {
          opacity: 1;
      }
  `,
);


const Controls = styled('div')(
  ({theme}) => css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing(1)};
      padding-bottom: ${theme.spacing(2)};
  `,
);

const AdditionalButtons = styled('div')(
  ({theme}) => css`
      display: flex;
      justify-content: space-between;
      gap: ${theme.spacing(2)};
  `,
);

function valuetext(value: number) {
  return format(value * 1000, {ms: true});
}

const VIDEO_FORMATS = ["mp4", "m4v", "mov", "avi", "wmv", "flv", "f4v", "webm", "mkv", "mpg", "mpeg"]
const VIDEO_RESOLUTIONS = ["720x480", "1080x720", "1920x1080", "2560x1440", "3840x2160"]
const VIDEO_ENCODERS = [
  "libx264",   // H.264 (very common for web and general use)
  "libx265",   // H.265 / HEVC (more efficient than H.264)
  "libvpx",    // VP8 (used in WebM)
  "libvpx-vp9",// VP9 (higher efficiency than VP8)
  "mpeg4",     // MPEG-4 Part 2
  "h263",      // H.263
  "libtheora", // Theora (used in Ogg)
  "prores",    // Apple ProRes
  "dnxhd",     // Avid DNxHD
]

const NVIDIA_VIDEO_ENCODERS = [
  "h264_nvenc",
  "hevc_nvenc",
  "av1_nvenc"
]


const VideoView = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)
  const videoElementRef = useRef<HTMLVideoElement>(null)
  const videoWrapperElementRef = useRef<HTMLDivElement>(null);

  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [backConfirmation, setBackConfirmation] = useState(false);

  // const audioUrls = useMemo(
  //   () => (appStateStore.currentVideo?.audioStreams ?? []).filter(x => x.path).map(x => convertFileSrc(x.path!)),
  //   [toJS(appStateStore.currentVideo?.audioStreams.map(x => x.path))]
  // )
  // const audioGains = useMemo(
  //   () => (appStateStore.currentVideo?.audioStreams ?? []).map(x => x.active ? x.gain : 0),
  //   [toJS(appStateStore.currentVideo?.audioStreams)]
  // )

  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [audioGains, setAudioGains] = useState<number[]>([]);
  const audioGainsThrottled = useThrottledCallback(
    (value: number[]) => {
      setAudioGains(value);
    },
    100
  );
  useEffect(() => {
    const dispose1 = autorun(() => {
      if (!appStateStore.currentVideo) return;

      const a = appStateStore.currentVideo.audioStreams
        .filter(x => x.streamIndex != appStateStore.currentVideo!.defaultAudioStreamIndex)
        .filter(x => x.path)
        .map(x => convertFileSrc(x.path!));

      setAudioUrls(a)
    })

    const dispose2 = autorun(() => {
      if (!appStateStore.currentVideo) return;

      const a = appStateStore.currentVideo.audioStreams
        .filter(x => x.streamIndex != appStateStore.currentVideo!.defaultAudioStreamIndex)
        .map(x => x.active ? gainToGainValue(x.gain) : 0);

      audioGainsThrottled(a)
    })

    return () => {
      dispose1()
      dispose2()
    };
  }, []);

  useSyncedMediaTracks(audioUrls, appStateStore.currentVideo?.audioStreams.length ?? 0, audioGains, videoElementRef)

  const audioCtx = useVideoGain(videoElementRef, appStateStore.currentVideo?.defaultAudioStream)

  useEffect(() => {
    if (backConfirmation) {
      const t = setTimeout(() => setBackConfirmation(false), 2000)
      return () => clearTimeout(t)
    }
  }, [backConfirmation]);

  useEffect(() => {
    const handleTimeUpdate = (e: Event) => {
      if (appStateStore.currentVideo) appStateStore.currentVideo.handleVideoStateChange("time", videoElementRef.current?.currentTime ?? 0)
    }

    const handleVideoPlay = (e: Event) => {
      if (appStateStore.currentVideo) {
        appStateStore.currentVideo.handleVideoStateChange("playing", true)
        appStateStore.currentVideo.handleVideoStateChange("loading", false)
      }
    }

    const handleVideoPause = (e: Event) => {
      if (appStateStore.currentVideo) appStateStore.currentVideo.handleVideoStateChange("playing", false)
    }

    const handleWaiting = (e: Event) => {
      if (appStateStore.currentVideo) appStateStore.currentVideo.handleVideoStateChange("loading", true)
    }

    const handleFullscreen = (e: Event) => {
      if (appStateStore.currentVideo) appStateStore.currentVideo.handleVideoStateChange("fullscreen", !!document.fullscreenElement)
    }

    videoElementRef.current?.addEventListener("timeupdate", handleTimeUpdate)
    videoElementRef.current?.addEventListener("play", handleVideoPlay)
    videoElementRef.current?.addEventListener("playing", handleVideoPlay)
    videoElementRef.current?.addEventListener("pause", handleVideoPause)
    videoElementRef.current?.addEventListener("waiting", handleWaiting)
    document.addEventListener("fullscreenchange", handleFullscreen)

    const dispose = autorun(() => {
      if (videoElementRef.current == null || appStateStore.currentVideo == null) return;

      if (appStateStore.currentVideo.videoTargetState.time != null)
        videoElementRef.current.currentTime = appStateStore.currentVideo.videoTargetState.time

      if (appStateStore.currentVideo.videoTargetState.playing != null) {
        appStateStore.currentVideo.videoTargetState.playing
          ? videoElementRef.current.play()
          : videoElementRef.current.pause()
      }

      if (appStateStore.currentVideo.videoTargetState.fullscreen != null) {
        if (appStateStore.currentVideo.videoTargetState.fullscreen) {
          videoWrapperElementRef.current?.requestFullscreen()
        } else {
          document.exitFullscreen()
        }
      }
    })
    return () => {
      dispose()
      videoElementRef.current?.removeEventListener("timeupdate", handleTimeUpdate)
      videoElementRef.current?.removeEventListener("play", handleVideoPlay)
      videoElementRef.current?.removeEventListener("pause", handleVideoPause)
      videoElementRef.current?.removeEventListener("pause", handleVideoPause)
      videoElementRef.current?.removeEventListener("waiting", handleWaiting)
      document.removeEventListener("fullscreenchange", handleFullscreen)
    }
  }, []);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;

      const keyCodeActions: Record<string, () => void> = {
        "Space": () => {
          appStateStore.currentVideo?.toggleVideoPlaying()
        },
        "ArrowRight": () => {
          appStateStore.currentVideo?.seekVideoBy(5)
        },
        "ArrowLeft": () => {
          appStateStore.currentVideo?.seekVideoBy(-5)
        },
        "KeyF": () => {
          appStateStore.currentVideo?.toggleVideoFullscreen()
        },
        "KeyA": () => {
          appStateStore.currentVideo?.handleStartHere()
        },
        "KeyD": () => {
          appStateStore.currentVideo?.handleEndHere()
        },
        "KeyR": () => {
          appStateStore.currentVideo?.handlePlayFromStart()
        },
      };

      const action = keyCodeActions[e.code];
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    }

    window.addEventListener("keydown", handleKeyPress)

    return () => window.removeEventListener("keydown", handleKeyPress)
  }, []);

  if (!appStateStore.currentVideo) return;

  const onLoadedMetadata = () => {
    if (!videoElementRef.current || !appStateStore.currentVideo) return;
    appStateStore.currentVideo.setVideoDuration(videoElementRef.current.duration)
  }

  const handleVideoClicked = () => {
    appStateStore.currentVideo?.toggleVideoPlaying()
  }

  const handleVideoDoubleClicked = () => {
    appStateStore.currentVideo?.toggleVideoFullscreen()
  }

  const handleExportClicked = () => {
    setExportModalOpen(true)
    appStateStore.currentVideo?.setVideoPlaying(false)
  }
  const handleExportModalClose = () => {
    setExportModalOpen(false)
  }

  const handleExportModalSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleExportModalClose()
    console.log("Exporting video...")
    appStateStore.currentVideo?.exportVideo()
  }

  const handleBackClicked = () => {
    audioCtx.current?.resume()
    if (!backConfirmation) {setBackConfirmation(true); return}

    appStateStore.closeCurrentVideo()
  }

  const handleClickSelectExportPath = async () => {
    const path = await save({
      filters: [
        {
          name: 'Video',
          extensions: VIDEO_FORMATS,
        },
        {
          name: 'All',
          extensions: ['*'],
        },
      ],
    });

    if (path) {
      appStateStore.currentVideo?.setExportPath(path)
    }
  }

  console.log("VideoView rendered!")

  return <ViewContainer>
    <VideoContainer>
      <VideoWrapper ref={videoWrapperElementRef}>
        <Video
          ref={videoElementRef}
          crossOrigin="anonymous"
          controlsList="nodownload noplaybackrate noremoteplayback novolume"
          controls={false}
          onLoadedMetadata={onLoadedMetadata}
          src={convertFileSrc(appStateStore.currentVideo.path)}
          onClick={handleVideoClicked}
          onDoubleClick={handleVideoDoubleClicked}
        />
        <VideoOverlayControlsWrapper align={"center"}>
          <VideoPlayPauseBlinker/>
        </VideoOverlayControlsWrapper>
        <VideoOverlayControlsWrapper>
          {appStateStore.currentVideo.videoState.fullscreen &&
            <VideoOverlayControls>
                <TimelineWithControls/>
            </VideoOverlayControls>
          }
        </VideoOverlayControlsWrapper>
      </VideoWrapper>
    </VideoContainer>
    <Controls>
      <TimelineWithControls/>
      <AdditionalButtons>
        <RangeButtons/>
        <Stack direction={"row"} spacing={1}>
          <Button variant={"outlined"} startIcon={<ArrowBackIcon/>} color={backConfirmation ? "error" : "info"} onClick={handleBackClicked}>{backConfirmation ? "Are you sure?" : "Back"}</Button>
          <Button variant={"outlined"} endIcon={<FileUploadIcon/>} color={"success"} onClick={handleExportClicked}>Export</Button>
        </Stack>
      </AdditionalButtons>
      <FormGroup sx={{minHeight: 84}}>
        {appStateStore.currentVideo.audioStreams.map((audioStream, index) => {
          const audioStreamPath = audioStream.path
          const defaultAudio = audioStream.streamIndex == appStateStore.currentVideo!.defaultAudioStreamIndex
          const audioStreamEnabled = audioStream.active

          return <Stack spacing={1} direction="row" sx={{alignItems: "center"}}>
            <FormControlLabel
              key={audioStream.streamIndex}
              control={<Checkbox
                checked={audioStreamEnabled}
                onChange={() => appStateStore.currentVideo!.toggleAudioStream(audioStream.streamIndex)}
              />}
              label={<Stack direction={"row"} sx={{gap: 1, alignItems: "center"}}>
                {`Audio stream #${index + 1}`}
                {!defaultAudio && !audioStreamPath && <CircularProgress size={15}/>}
              </Stack>}
            />
            {(defaultAudio || audioStreamPath) && <AudioVolumeSlider audioStream={audioStream}/>}
          </Stack>;
        })}
      </FormGroup>
    </Controls>

    <Dialog open={exportModalOpen} onClose={handleExportModalClose} maxWidth={"md"} fullWidth>
      <DialogTitle>Export video</DialogTitle>
      <DialogContent>
        <form onSubmit={handleExportModalSubmit} id="subscription-form">
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField
                autoFocus
                required
                margin="dense"
                label="Export path"
                fullWidth
                variant="outlined"
                value={appStateStore.currentVideo.exportPath}
                onChange={(e) => appStateStore.currentVideo?.setExportPath(e.target.value)}
                slotProps={{
                  input: {
                    endAdornment: <InputAdornment position="end">
                      <IconButton
                        onClick={handleClickSelectExportPath}
                        // onMouseDown={handleMouseDownPassword}
                        // onMouseUp={handleMouseUpPassword}
                        edge="end"
                      >
                        <FolderIcon/>
                      </IconButton>
                    </InputAdornment>
                  }
                }}
              />
            </Grid>
            <Grid size={4}>
              <TextField
                required
                select
                fullWidth
                label="Video format"
                value={appStateStore.currentVideo.exportFormat}
                onChange={(e) => appStateStore.currentVideo?.setExportFormat(e.target.value)}
              >
                {VIDEO_FORMATS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={4}>
              <Autocomplete
                freeSolo
                options={[...(appStateStore.currentVideo.exportGpuAcceleration == "nvidia" ? NVIDIA_VIDEO_ENCODERS : []), ...VIDEO_ENCODERS]}
                value={appStateStore.currentVideo.exportVideoEncoder}
                onChange={(e, newValue) => appStateStore.currentVideo?.setExportVideoEncoder(newValue)}
                renderInput={(params) => <TextField {...params} fullWidth label="Video encoder" />}
              />
            </Grid>
            <Grid size={4}>
              <Autocomplete
                freeSolo
                options={VIDEO_RESOLUTIONS}
                value={appStateStore.currentVideo.exportResolution}
                onChange={(e, newValue) => appStateStore.currentVideo?.setExportResolution(newValue ?? "")}
                renderInput={(params) => <TextField {...params} required fullWidth label="Resolution" />}
              />
            </Grid>
            <Grid size={4}>
              <TextField
                label="Bitrate"
                placeholder="Auto"
                fullWidth
                value={appStateStore.currentVideo.exportBitrateKbps ?? ""}
                onChange={(e) => appStateStore.currentVideo?.setExportBitrateKbps(e.target.value ? parseInt(e.target.value) : null)}
                helperText={appStateStore.currentVideo.exportBitrateKbps && `Estimated file size ${appStateStore.currentVideo.estimatedVideoSizeMb}Mb`}
                slotProps={{
                  input: {
                    type: "number",
                    startAdornment: <></>,
                    endAdornment: <InputAdornment position="end">kBit/s</InputAdornment>,
                  },
                }}
              />
            </Grid>
            <Grid size={4}>
              <TextField
                label="Framerate"
                placeholder="Auto"
                fullWidth
                value={appStateStore.currentVideo.exportFrameRate ?? ""}
                onChange={(e) => appStateStore.currentVideo?.setExportFrameRate(e.target.value ? parseInt(e.target.value) : null)}
                slotProps={{
                  input: {
                    type: "number",
                    startAdornment: <></>,
                    endAdornment: <InputAdornment position="end">fps</InputAdornment>,
                  },
                }}
              />
            </Grid>
            <Grid size={4}>
              <FormControl fullWidth>
                <InputLabel>GPU Acceleration</InputLabel>
                <Select
                  value={appStateStore.currentVideo.exportGpuAcceleration}
                  label="GPU Acceleration"
                  onChange={e => appStateStore.currentVideo?.setExportGpuAcceleration(e.target.value ? e.target.value as GpuAcceleration : null)}
                >
                  <MenuItem value={""}>None</MenuItem>
                  <MenuItem value={"nvidia" as GpuAcceleration}>Nvidia</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </form>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleExportModalClose}>Cancel</Button>
        <Button type="submit" form="subscription-form">
          Export video
        </Button>
      </DialogActions>
    </Dialog>
  </ViewContainer>
})

const formatTime = (value: number) => {
  return format(value * 1000, {})
}

const TimelineWithControls = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  if (!appStateStore.currentVideo) return null;

  return <Box sx={{display: "flex", alignItems: "end", gap: 1, width: "100%"}}>
    <Box sx={{marginBottom: "2px"}}>
      <IconButton onClick={appStateStore.currentVideo?.toggleVideoPlaying}>
        {
          appStateStore.currentVideo.videoState.playing
            ? <PauseIcon/>
            : <PlayArrowIcon/>
        }
      </IconButton>
    </Box>
    <Timeline/>
    <Box sx={{marginBottom: "8px", marginLeft: 1.3}}>
      {formatTime(appStateStore.currentVideo.videoState.time ?? 0)} / {formatTime(appStateStore.currentVideo.duration ?? 0)}
    </Box>
    <Box sx={{marginBottom: "2px"}}>
      <IconButton onClick={appStateStore.currentVideo?.toggleVideoFullscreen}>
        {appStateStore.currentVideo.videoState.fullscreen
          ? <FullscreenExitIcon/>
          : <FullscreenIcon/>
        }
      </IconButton>
    </Box>
  </Box>
})

const TimelineSlider = styled(Slider)(
  ({theme}) => css`
      pointer-events: none;
      
      & .MuiSlider-thumb {
          pointer-events: auto;
          height: 27px;
          width: 12px;
          background-color: #fff;
          border: 1px solid ${theme.palette.primary.dark};
          border-radius: 5px;
    
          //&:hover {
          //    boxShadow: 0 0 0 8px rgba(58, 133, 137, 0.16);
          //}
          
          &[data-index='0'] { // Left thumb
            transform: translate(-100%, -50%);
          }
    
          &[data-index='1'] { // Right thumb
              transform: translate(0, -50%);
          }
    
          & .bar {
              height: 12px;
              width: 2px;
              background-color: ${theme.palette.primary.dark};
              margin-left: 1px;
              margin-right: 1px;
          }
      }
      
      & .MuiSlider-track {
          border-radius: 0;
      }
  `,
)

const VideoProgressSlider = styled(Slider)(
  ({theme}) => css`
      & .MuiSlider-thumb {
          top: -15px;
          
          & > .pin {
              position: relative;
              width: 4px;
              height: 25px;
              background-color: ${theme.palette.primary.main};
              top: 17px;
              border-radius: 20%;
          }
      }
  `,
)

const Timeline = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  const [progress, setProgress] = useState(0);

  const throttle = useThrottledCallback((v: number) => {
    if (!appStateStore.currentVideo) return;
    appStateStore.currentVideo.setVideoTime(v)
  }, 100)

  if (!appStateStore.currentVideo) return null;

  const handleVideoProgressSliderChange = (e: Event, v: number | number[]) => {
    if (!appStateStore.currentVideo || typeof v != "number") return;
    setProgress(v)
    throttle(v)
  }

  const sliderValue = [appStateStore.currentVideo.trimStart ?? 0, appStateStore.currentVideo.trimEnd ?? 0]
  const handleSliderValueChange = (e: Event, v: number[] | number) => {
    if (!appStateStore.currentVideo || typeof v == "number") return;
    appStateStore.currentVideo.updateVideoTrimValues(v[0], v[1]);
  }

  useEffect(() => {
    const dispose = autorun(() => {
      if (!appStateStore.currentVideo) return;
      setProgress(appStateStore.currentVideo.videoState.time)
    })

    return () => dispose()
  }, []);

  return <Box sx={{display: "grid", marginTop: 4, flex: "1", marginLeft: "12px", marginRight: "12px"}}>
    <Box sx={{gridRow: "1", gridColumn: "1"}}>
      <VideoProgressSlider
        value={progress}
        onChange={handleVideoProgressSliderChange}
        valueLabelDisplay="auto"
        getAriaValueText={valuetext}
        valueLabelFormat={valuetext}
        max={appStateStore.currentVideo.duration ?? 0}
        step={0.0001}
        slots={{
          rail: () => <></>,
          track: () => <></>,
          thumb: VideoProgressThumbComponent,
        }}
      />
    </Box>
    <Box sx={{gridRow: "1", gridColumn: "1"}}>
      <TimelineSlider
        value={sliderValue}
        onChange={handleSliderValueChange}
        valueLabelDisplay="auto"
        getAriaValueText={valuetext}
        valueLabelFormat={valuetext}
        slots={{thumb: TimelineTrimThumbComponent}}
        max={appStateStore.currentVideo.duration ?? 0}
        step={0.01}
        disableSwap
      />
    </Box>
  </Box>
})

function TimelineTrimThumbComponent(props: React.HTMLAttributes<unknown>) {
  const { children, ...other } = props;
  return (
    <SliderThumb {...other}>
      {children}
      <span className="bar" />
      <span className="bar" />
    </SliderThumb>
  );
}

function VideoProgressThumbComponent(props: React.HTMLAttributes<unknown>) {
  const { children, ...other } = props;
  return (
    <SliderThumb {...other}>
      {children}
      <span className="pin" />
    </SliderThumb>
  );
}

function gainLabelFormat(v: number) {
  return `${v.toFixed(1)}%`
}

const AudioVolumeSlider = observer(({audioStream}: {audioStream: AudioStream}) => {
  const appStateStore = useContext(AppStateStoreContext)

  if (!appStateStore.currentVideo) return null;

  const onInputValueChanged = (e: ChangeEvent<HTMLInputElement>) => {
    const number = parseInt(e.target.value)
    appStateStore.currentVideo?.updateAudioStreamGain(audioStream.streamIndex, !isNaN(number) ? number : 0)
  }

  return <Stack spacing={2} direction="row" sx={{ alignItems: 'center', width: 400 }}>
    <VolumeDown />
    <Slider
      value={audioStream.gain}
      onChange={(e, v) => appStateStore.currentVideo?.updateAudioStreamGain(audioStream.streamIndex, v)}
      aria-label="Volume"
      color={audioStream.active ? (audioStream.gain > 100 ? "warning" : "primary") : "secondary"}
      min={0}
      max={200}
      // valueLabelFormat={gainLabelFormat}
      // valueLabelDisplay="auto"
      step={(audioStream.gain > 98 && audioStream.gain < 102) ? 10 : 0.1}
      marks={[
        {value: 100}
      ]}
    />
    <VolumeUp />
    <Input
      value={audioStream.gain}
      size="small"
      sx={{width: 150}}
      onChange={onInputValueChanged}
      endAdornment={<InputAdornment position="end">%</InputAdornment>}
      inputProps={{
        step: 10,
        min: 0,
        type: 'number',
        'aria-labelledby': 'input-slider',
      }}
    />
  </Stack>
})

const RangeButtons = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  if (!appStateStore.currentVideo) return null;

  return <Stack direction={"row"} spacing={1}>
    <Tooltip title="Hotkey: [A]" disableInteractive>
      <Button
        variant={"outlined"}
        disabled={appStateStore.currentVideo.startHereDisabled}
        onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handleStartHere()}
      >
        Start Here
      </Button>
    </Tooltip>
    <Tooltip title="Hotkey: [D]" disableInteractive>
      <Button
        variant={"outlined"}
        disabled={appStateStore.currentVideo.endHereDisabled}
        onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handleEndHere()}
      >
        End Here
      </Button>
    </Tooltip>
    <Tooltip title="Hotkey: [R]" disableInteractive>
      <Button
        variant={"outlined"}
        onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handlePlayFromStart()}
        startIcon={<ReplayIcon/>}
      >
        Play from start
      </Button>
    </Tooltip>
  </Stack>
})

const VideoPlayPauseBlinkerWrapper = styled('div')(
  ({theme}) => css`
      opacity: 0;
      
      &.blink {
          animation: pulse 500ms infinite;
      }

      @keyframes pulse {
          0% { 
              transform: scale(1); 
              opacity: 0;
          }
          50% { 
              transform: scale(1.2);
              opacity: 0.7;
          }
          100% { 
              transform: scale(1.3);
              opacity: 0;
          }
      }
  `
)

const VideoPlayPauseBlinker = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  const [blinkPlayPauseIcon, setBlinkPlayPauseIcon] = useState(false);
  useEffect(() => {
    setTimeout(() => setBlinkPlayPauseIcon(true), 10)
    const timeout = setTimeout(() => setBlinkPlayPauseIcon(false), 500)
    return () => {
      setBlinkPlayPauseIcon(false)
      clearTimeout(timeout)
    }
  }, [appStateStore.currentVideo?.videoState.playing]);

  if (!appStateStore.currentVideo) return null;

  return <VideoPlayPauseBlinkerWrapper className={blinkPlayPauseIcon ? "blink" : ""}>
    {
      appStateStore.currentVideo.videoState.playing
        ? <PlayCircleIcon sx={{fontSize: 80}}/>
        : <PauseCircleIcon sx={{fontSize: 80}}/>
    }
  </VideoPlayPauseBlinkerWrapper>
})

export default VideoView;