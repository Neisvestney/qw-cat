import {observer} from "mobx-react-lite";
import {useContext, useState} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Avatar,
  Box,
  Button, CircularProgress,
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
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import VideocamIcon from "@mui/icons-material/Videocam";
import {FfmpegTask} from "../generated/bindings/FfmpegTask.ts";
import CircularProgressWithLabel from "./ui/CircularProgressWithLabel.tsx";
import {green, blue} from "@mui/material/colors";
import {revealItemInDir} from '@tauri-apps/plugin-opener';
import {Audiotrack} from "@mui/icons-material";

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
        icon: <AudiotrackIcon/>,
        onClick: null,
      }
    case "exportVideo":
      const outputPath = ffmpegTask.taskType.options.outputPath;

      return{
        label: {
          "queued": "Video export queued",
          "inProgress": "Exporting video",
          "finished": "Video exported",
        }[ffmpegTask.status.type],
        secondary: outputPath,
        icon: <VideocamIcon/>,
        onClick: () => revealItemInDir(outputPath)
      }
  }
}


const FfmpegTasksQueueView = observer(() => {
  const appStateStore = useContext(AppStateStoreContext)

  const [drawer, setDrawer] = useState(false)

  const DrawerList = (
    <Box sx={{width: 500}} role="presentation">
      <List>
        {appStateStore.ffmpegTasksQueue.ffmpegTasks.slice().reverse().map((ffmpegTask, index) => {
            const ItemBody = <>
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

            return <ListItem
              sx={{padding: getTaskView(ffmpegTask).onClick ? 0 : 1}}
              ley={index}
              secondaryAction={
                <Stack direction={"row"} spacing={1}>
                  {ffmpegTask.status.type == "inProgress" &&
                    (ffmpegTask.status.progress != 0
                      ? <CircularProgressWithLabel value={ffmpegTask.status.progress * 100}/>
                      : <CircularProgress size={30}/>)
                  }
                  {/*<IconButton edge="end" aria-label="delete">*/}
                  {/*  <DeleteIcon/>*/}
                  {/*</IconButton>*/}
                </Stack>
              }
            >
              {getTaskView(ffmpegTask).onClick
                ? <ListItemButton sx={{padding: 1}} onClick={getTaskView(ffmpegTask).onClick ?? undefined}>{ItemBody}</ListItemButton>
                : ItemBody
              }
            </ListItem>;
          }
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
          (ffmpegTask.status.progress != 0
            ? <CircularProgressWithLabel value={ffmpegTask.status.progress * 100}/>
            : <CircularProgress size={30}/>)
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