import {observer} from "mobx-react-lite";
import React, {ChangeEvent, ReactEventHandler, useContext, useEffect, useMemo, useRef, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Button,
  ButtonGroup,
  Slider,
  Stack,
  styled,
  Dialog,
  DialogTitle,
  DialogActions,
  DialogContent,
  DialogContentText,
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
  Input,
} from "@mui/material";
import {css} from '@emotion/react';
import {convertFileSrc} from "@tauri-apps/api/core";
import format from 'format-duration';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {autorun, toJS} from "mobx";
import {useSyncedMediaTracks} from "../lib/useSyncedMediaTracks.ts";
import FolderIcon from "@mui/icons-material/Folder";
import {save} from "@tauri-apps/plugin-dialog";
import estimateVideoSize from "../lib/estimateVideoSize.ts";
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

const Video = styled('video')(
  ({theme}) => css`
      max-width: 100%;
      max-height: 100%;
  `,
);

const Controls = styled('div')(
  ({theme}) => css`
      display: flex;
      flex-direction: column;
      min-height: 180px;
  `,
);

const AdditionalButtons = styled('div')(
  ({theme}) => css`
      padding-top: ${theme.spacing(2)};
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
  const videoElement = useRef<HTMLVideoElement>(null)
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

  useSyncedMediaTracks(audioUrls, appStateStore.currentVideo?.audioStreams.length ?? 0, audioGains, videoElement)

  const audioCtx = useVideoGain(videoElement, appStateStore.currentVideo?.defaultAudioStream)

  useEffect(() => {
    if (backConfirmation) {
      const t = setTimeout(() => setBackConfirmation(false), 2000)
      return () => clearTimeout(t)
    }
  }, [backConfirmation]);

  useEffect(() => {
    if (videoElement.current == null || appStateStore.currentVideo?.videoTargetTime == null) return;

    videoElement.current.currentTime = appStateStore.currentVideo.videoTargetTime;
  }, [appStateStore.currentVideo?.videoTargetTime]);

  if (!appStateStore.currentVideo) return;

  const onLoadedMetadata = () => {
    if (!videoElement.current || !appStateStore.currentVideo) return;
    appStateStore.currentVideo.setVideoDuration(videoElement.current.duration)
  }

  const handleExportClicked = () => {
    setExportModalOpen(true)
    videoElement.current?.pause()
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

  return <ViewContainer>
    <VideoContainer>
      <VideoWrapper>
        <Video
          ref={videoElement}
          crossOrigin="anonymous"
          controlsList="nodownload noplaybackrate noremoteplayback novolume"
          controls
          onLoadedMetadata={onLoadedMetadata}
          src={convertFileSrc(appStateStore.currentVideo.path)}
          onTimeUpdate={(e) => {
            if (appStateStore.currentVideo) appStateStore.currentVideo.onVideoCurrentTimeChanged(e.currentTarget.currentTime)
          }}
        />
      </VideoWrapper>
    </VideoContainer>
    <Controls>
      <Timeline/>
      <AdditionalButtons>
        <RangeButtons/>
        <Stack direction={"row"} spacing={1}>
          <Button variant={"outlined"} startIcon={<ArrowBackIcon/>} color={backConfirmation ? "error" : "info"} onClick={handleBackClicked}>{backConfirmation ? "Are you sure?" : "Back"}</Button>
          <Button variant={"outlined"} endIcon={<FileUploadIcon/>} color={"success"} onClick={handleExportClicked}>Export</Button>
        </Stack>
      </AdditionalButtons>
      <FormGroup>
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

const Timeline = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  if (!appStateStore.currentVideo) return null;

  const sliderValue = [appStateStore.currentVideo.trimStart ?? 0, appStateStore.currentVideo.trimEnd ?? 0]
  const handleSliderValueChange = (e: Event, v: number[]) => {
    if (!appStateStore.currentVideo) return;
    appStateStore.currentVideo.updateVideoTrimValues(v[0], v[1]);
  }

  return <Slider
    sx={{marginLeft: 2, marginRight: 2, width: "auto"}}
    value={sliderValue}
    onChange={handleSliderValueChange}
    valueLabelDisplay="auto"
    getAriaValueText={valuetext}
    valueLabelFormat={valuetext}
    max={appStateStore.currentVideo.duration ?? 0}
    step={0.01}
    disableSwap
  />
})

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
    <Button
      variant={"outlined"}
      disabled={appStateStore.currentVideo.startHereDisabled}
      onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handleStartHere()}
    >
      Start Here
    </Button>
    <Button
      variant={"outlined"}
      disabled={appStateStore.currentVideo.endHereDisabled}
      onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handleEndHere()}
    >
      End Here
    </Button>
    <Button
      variant={"outlined"}
      onClick={() => appStateStore.currentVideo && appStateStore.currentVideo.handlePlayFromStart()}
      startIcon={<ReplayIcon/>}
    >
      Play from start
    </Button>
  </Stack>
})

export default VideoView;