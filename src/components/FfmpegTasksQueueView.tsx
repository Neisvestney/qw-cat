import {observer} from "mobx-react-lite";
import {useContext, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Drawer,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Snackbar,
  Stack,
  IconButton,
} from "@mui/material";
import ListIcon from "@mui/icons-material/List";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import VideocamIcon from "@mui/icons-material/Videocam";
import DownloadIcon from "@mui/icons-material/Download";
import {FfmpegTask} from "../generated/bindings/FfmpegTask.ts";
import CircularProgressWithLabel from "./ui/CircularProgressWithLabel.tsx";
import {blue, green, red, grey} from "@mui/material/colors";
import {revealItemInDir} from "@tauri-apps/plugin-opener";
import {LogsStoreContext} from "../stores/LogsStore.ts";
import CloseIcon from "@mui/icons-material/Close";

const getFfmpegTaskLabel = (ffmpegTask: FfmpegTask | null) => {
  if (!ffmpegTask) return "No tasks running";

  return getTaskView(ffmpegTask).label;
};

const taskStatusColors = {
  queued: undefined,
  inProgress: blue[500],
  finished: green[500],
  failed: red[600],
  cancelled: grey[600],
};

const getTaskView = (ffmpegTask: FfmpegTask) => {
  switch (ffmpegTask.taskType.type) {
    case "extractAudio":
      return {
        label: {
          queued: "Audio preparation queued",
          inProgress: "Preparing audio",
          finished: "Audio prepared",
          failed: "Audio preparation failed - see logs for more info",
          cancelled: "Audio preparation cancelled",
        }[ffmpegTask.status.type],
        secondary: `${ffmpegTask.taskType.videoFilePath}`,
        icon: <AudiotrackIcon />,
        onClick: null,
      };
    case "exportVideo":
      const outputPath = ffmpegTask.taskType.options.outputPath;

      return {
        label: {
          queued: "Video export queued",
          inProgress: "Exporting video",
          finished: "Video exported",
          failed: "Video export failed - see logs for more info",
          cancelled: "Video export cancelled",
        }[ffmpegTask.status.type],
        secondary: outputPath,
        icon: <VideocamIcon />,
        onClick: () => revealItemInDir(outputPath),
      };
    case "downloadFfmpeg":
      return {
        label: {
          queued: "Ffmpeg download queued",
          inProgress: "Downloading ffmpeg",
          finished: "FFmpeg downloaded",
          failed: "FFmpeg download failed - see logs for more info",
          cancelled: "Ffmpeg download cancelled",
        }[ffmpegTask.status.type],
        secondary: "",
        icon: <DownloadIcon />,
        onClick: null,
      };
  }
};

const filterTask = (ffmpegTasks: FfmpegTask) =>
  ffmpegTasks.taskType.type != "downloadFfmpeg" || !ffmpegTasks.taskType.result?.already_installed;

const FfmpegTasksQueueView = observer(() => {
  const appStateStore = useContext(AppStateStoreContext);
  const logsStore = useContext(LogsStoreContext);

  const [drawer, setDrawer] = useState(false);

  const DrawerList = (
    <Box
      sx={{width: 500, padding: 1, display: "flex", flexDirection: "column", height: "100%"}}
      role="presentation"
    >
      <List
        sx={{
          flex: 1,
          marginBottom: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column-reverse",
          justifyContent: "flex-end",
        }}
      >
        {appStateStore.ffmpegTasksQueue.ffmpegTasks.filter(filterTask).length == 0 && (
          <ListItem>
            <ListItemAvatar>
              <Avatar>
                <ListIcon />
              </Avatar>
            </ListItemAvatar>
            <ListItemText primary={"No tasks has been queued"} />
          </ListItem>
        )}
        {appStateStore.ffmpegTasksQueue.ffmpegTasks.slice().map((ffmpegTask, index) => {
          const ItemBody = (
            <>
              <ListItemAvatar>
                <Avatar sx={{bgcolor: taskStatusColors[ffmpegTask.status.type]}}>
                  {getTaskView(ffmpegTask).icon}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={getTaskView(ffmpegTask).label}
                secondary={getTaskView(ffmpegTask).secondary}
              />
            </>
          );

          return (
            <ListItem
              sx={{
                padding: getTaskView(ffmpegTask).onClick ? 0 : 1,
                display: filterTask(ffmpegTask) ? undefined : "none",
              }}
              key={index}
              secondaryAction={
                <Stack direction={"row"} spacing={1}>
                  {ffmpegTask.status.type == "inProgress" &&
                    (ffmpegTask.status.progress != 0 ? (
                      <CircularProgressWithLabel value={ffmpegTask.status.progress * 100} />
                    ) : (
                      <CircularProgress size={30} />
                    ))}
                  {ffmpegTask.status.type == "inProgress" && (
                    <IconButton
                      edge="end"
                      aria-label="delete"
                      onClick={() => appStateStore.ffmpegTasksQueue.cancelTask(index)}
                    >
                      <CloseIcon />
                    </IconButton>
                  )}
                </Stack>
              }
            >
              {getTaskView(ffmpegTask).onClick ? (
                <ListItemButton
                  sx={{padding: 1}}
                  onClick={getTaskView(ffmpegTask).onClick ?? undefined}
                >
                  {ItemBody}
                </ListItemButton>
              ) : (
                ItemBody
              )}
            </ListItem>
          );
        })}
      </List>
      <Box>
        <Button onClick={() => logsStore.setLogsWindowOpen(true)}>Show logs</Button>
      </Box>
    </Box>
  );

  const ffmpegTask = appStateStore.ffmpegTasksQueue.lastInProgressOrLastTaskFromQueue;

  return (
    <>
      <Drawer open={drawer} anchor={"right"} onClose={() => setDrawer(false)} sx={{zIndex: 1450}}>
        {DrawerList}
      </Drawer>
      <Snackbar
        // open={appStateStore.ffmpegTasksQueue.ffmpegTasks.length > 0}
        open
        anchorOrigin={{vertical: "bottom", horizontal: "right"}}
        message={
          ffmpegTask?.status.type != "finished"
            ? getFfmpegTaskLabel(ffmpegTask)
            : getFfmpegTaskLabel(null)
        }
        action={
          <>
            {ffmpegTask?.status.type == "inProgress" &&
              (ffmpegTask.status.progress != 0 ? (
                <CircularProgressWithLabel value={ffmpegTask.status.progress * 100} />
              ) : (
                <CircularProgress size={30} />
              ))}
          </>
        }
        slotProps={{
          content: {
            onClick: () => setDrawer(true),
            sx: {
              backgroundColor: "grey.900",
              cursor: "pointer",
              minHeight: "52px",
              color: (theme) => theme.palette.getContrastText(theme.palette.grey[900]),
            },
          },
        }}
      ></Snackbar>
    </>
  );
});

export default FfmpegTasksQueueView;
