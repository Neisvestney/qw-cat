import {observer} from "mobx-react-lite";
import React, {ReactEventHandler, useContext, useEffect, useMemo, useRef, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {Button, ButtonGroup, Slider, Stack, styled, Dialog, DialogTitle, DialogActions, DialogContent, DialogContentText, TextField, FormGroup, FormControlLabel, Checkbox, CircularProgress, InputAdornment, IconButton, Grid, MenuItem, Autocomplete} from "@mui/material";
import {css} from '@emotion/react';
import {convertFileSrc} from "@tauri-apps/api/core";
import format from 'format-duration';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {toJS} from "mobx";
import {useSyncedMediaTracks} from "../lib/useSyncedMediaTracks.ts";
import FolderIcon from "@mui/icons-material/Folder";
import {save} from "@tauri-apps/plugin-dialog";
import estimateVideoSize from "../lib/estimateVideoSize.ts";


const VideoContainer = styled('div')(
  ({theme}) => css`
      background-color: ${theme.palette.grey["900"]};
      height: 540px;
      display: flex;
      justify-content: center;
  `,
);


const Video = styled('video')(
  ({theme}) => css`
      max-width: 100%;
      max-height: 100%;
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


const VideoView = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)
  const videoElement = useRef<HTMLVideoElement>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [backConfirmation, setBackConfirmation] = useState(false);

  const audioUrls = useMemo(
    () => (appStateStore.currentVideo?.audioStreamsFilePaths ?? []).map(x => convertFileSrc(x.path)),
    [toJS(appStateStore.currentVideo?.audioStreamsFilePaths)]
  )
  const audioGains = useMemo(
    () => (appStateStore.currentVideo?.audioStreamsFilePaths ?? []).map(x => appStateStore.currentVideo?.activeAudioStreamIndexes.includes(x.index) ? 1 : 0),
    [toJS(appStateStore.currentVideo?.audioStreamsFilePaths), toJS(appStateStore.currentVideo?.activeAudioStreamIndexes)]
  )

  useSyncedMediaTracks(audioUrls, audioGains, videoElement)

  useEffect(() => {
    if (!appStateStore.currentVideo || !videoElement.current) return;

    const defaultAudioStreamEnabled = appStateStore.currentVideo.activeAudioStreamIndexes.includes(appStateStore.currentVideo.defaultAudioStreamIndex)
    videoElement.current.volume = defaultAudioStreamEnabled ? 1 : 0
  }, [toJS(appStateStore.currentVideo?.activeAudioStreamIndexes)]);

  useEffect(() => {
    if (backConfirmation) {
      const t = setTimeout(() => setBackConfirmation(false), 2000)
      return () => clearTimeout(t)
    }
  }, [backConfirmation]);

  if (!appStateStore.currentVideo) return;

  const onLoadedMetadata = () => {
    if (!videoElement.current || !appStateStore.currentVideo) return;
    appStateStore.currentVideo.setVideoDuration(videoElement.current.duration)
  }

  const sliderValue = [appStateStore.currentVideo.trimStart ?? 0, appStateStore.currentVideo.trimEnd ?? 0]
  const handleSliderValueChange = (e: Event, v: number[]) => {
    if (!appStateStore.currentVideo) return;
    appStateStore.currentVideo.updateVideoTrimValues(v[0], v[1]);
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

  return <Stack>
    <VideoContainer>
      <Video
        ref={videoElement}
        controls
        onLoadedMetadata={onLoadedMetadata}
        src={convertFileSrc(appStateStore.currentVideo.path)}
        onTimeUpdate={(e) => {
          if (appStateStore.currentVideo) appStateStore.currentVideo.videoCurrentTime = e.currentTarget.currentTime
        }}
      />
    </VideoContainer>
    <Slider
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
    <AdditionalButtons>
      <Stack direction={"row"} spacing={1}>
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
      </Stack>
      <Stack direction={"row"} spacing={1}>
        <Button variant={"outlined"} startIcon={<ArrowBackIcon/>} color={backConfirmation ? "error" : "info"} onClick={handleBackClicked}>{backConfirmation ? "Are you sure?" : "Back"}</Button>
        <Button variant={"outlined"} endIcon={<FileUploadIcon/>} color={"success"} onClick={handleExportClicked}>Export</Button>
      </Stack>
    </AdditionalButtons>
    <FormGroup>
      {appStateStore.currentVideo.audioStreamsInfo.audioStreams.map((audioStream, index) => {
        const audioStreamPath = appStateStore.currentVideo!.getAudioStreamFilePath(audioStream.index)
        const defaultAudio = audioStream.index == appStateStore.currentVideo!.defaultAudioStreamIndex

        return <FormControlLabel
          key={audioStream.index}
          control={<Checkbox
            checked={appStateStore.currentVideo!.activeAudioStreamIndexes.includes(audioStream.index)}
            onChange={() => appStateStore.currentVideo!.toggleAudioStream(audioStream.index)}
          />}
          label={<Stack direction={"row"} sx={{gap: 1, alignItems: "center"}}>
            {`Audio stream #${index + 1}`}
            {!defaultAudio && !audioStreamPath && <CircularProgress size={15}/>}
          </Stack>}
        />;
      })}
    </FormGroup>

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
            <Grid size={3}>
              <TextField
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
            <Grid size={3}>
              <Autocomplete
                freeSolo
                options={VIDEO_RESOLUTIONS}
                value={appStateStore.currentVideo.exportResolution}
                onChange={(e, newValue) => appStateStore.currentVideo?.setExportResolution(newValue ?? "")}
                renderInput={(params) => <TextField {...params} required fullWidth label="Resolution" />}
              />
            </Grid>
            <Grid size={3}>
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
                    endAdornment: <InputAdornment position="end">kBit/s</InputAdornment>,
                  },
                }}
              />
            </Grid>
            <Grid size={3}>
              <TextField
                label="Framerate"
                placeholder="Auto"
                fullWidth
                value={appStateStore.currentVideo.exportFrameRate ?? ""}
                onChange={(e) => appStateStore.currentVideo?.setExportFrameRate(e.target.value ? parseInt(e.target.value) : null)}
                slotProps={{
                  input: {
                    type: "number",
                    endAdornment: <InputAdornment position="end">fps</InputAdornment>,
                  },
                }}
              />
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
  </Stack>
})

export default VideoView;