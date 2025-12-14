import {observer} from "mobx-react-lite";
import {useContext, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
  Stack,
} from "@mui/material";
import DeleteIcon from '@mui/icons-material/Delete';
import FolderIcon from '@mui/icons-material/Folder';
import AudioFileIcon from "@mui/icons-material/AudioFile";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import {FfmpegTask} from "../generated/bindings/FfmpegTask.ts";
import CircularProgressWithLabel from "./ui/CircularProgressWithLabel.tsx";
import {green, blue} from "@mui/material/colors";

const getFfmpegTaskLabel = (ffmpegTask: FfmpegTask | null) => {
  if (!ffmpegTask) return "No tasks running";

  return getTaskView(ffmpegTask).label
}

const taskStatusColors = {
  queued: undefined,
  inProgress: blue[500],
  finished: green[500]
}

const getTaskView = (ffmpegTask: FfmpegTask) => {
  switch (ffmpegTask.taskType.type) {
    case "extractAudio":
      return {
        label: {
          "queued": "Audio preparation queued",
          "inProgress": "Preparing audio",
          "finished": "Audio prepared",
        }[ffmpegTask.status.type],
        secondary: `${ffmpegTask.taskType.videoFilePath}`,
        icon: <AudioFileIcon/>,
      }
    case "exportVideo":
      return{
        label: "Exporting video",
        secondary: "",
        icon: <VideoFileIcon/>,
      }
  }
}


const FfmpegTasksQueueView = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  const [drawer, setDrawer] = useState(false)

  const DrawerList = (
    <Box sx={{width: 500}} role="presentation">
      <List>
        {appStateStore.ffmpegTasksQueue.ffmpegTasks.slice().reverse().map((ffmpegTask, index) =>
          <ListItem
            secondaryAction={
              <Stack direction={"row"} spacing={1}>
                {ffmpegTask.status.type == "inProgress" &&
                    <CircularProgressWithLabel value={ffmpegTask.status.progress * 100}/>
                }
                {/*<IconButton edge="end" aria-label="delete">*/}
                {/*  <DeleteIcon/>*/}
                {/*</IconButton>*/}
              </Stack>
            }
          >
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: taskStatusColors[ffmpegTask.status.type] }}>
                {getTaskView(ffmpegTask).icon}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={getTaskView(ffmpegTask).label}
              secondary={getTaskView(ffmpegTask).secondary}
            />
          </ListItem>
        )}
      </List>
    </Box>
  );

  const ffmpegTask = appStateStore.ffmpegTasksQueue.lastInProgressOrLastTaskFromQueue

  return <>
    <Drawer open={drawer} anchor={"right"} onClose={() => setDrawer(false)} sx={{zIndex: 1450}}>
      {DrawerList}
    </Drawer>
    <Snackbar
      open={appStateStore.ffmpegTasksQueue.ffmpegTasks.length > 0}
      anchorOrigin={{vertical: "bottom", horizontal: "right"}}
      message={getFfmpegTaskLabel(ffmpegTask)}
      action={<>
        {ffmpegTask && ffmpegTask.status.type == "inProgress" &&
            <CircularProgressWithLabel value={ffmpegTask.status.progress * 100}/>
        }
      </>}
      slotProps={{
        content: {
          onClick: () => setDrawer(true),
          sx: {
            backgroundColor: 'grey.900',
            cursor: 'pointer',
            color: (theme) => theme.palette.getContrastText(theme.palette.grey[900]),
          }
        }
      }}
    >
    </Snackbar>
  </>
})

export default FfmpegTasksQueueView;