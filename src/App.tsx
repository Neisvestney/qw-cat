import {useEffect, useState} from "react";
import {convertFileSrc, invoke} from "@tauri-apps/api/core";
import styles from "./App.module.scss";
import {observer} from "mobx-react-lite";
import AppStateStore, {AppStateStoreContext} from "./stores/AppStateStore.ts";
import {Drawer, Button, CssBaseline, Container, Snackbar, ThemeProvider, Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Divider} from "@mui/material";
import InboxIcon from '@mui/icons-material/MoveToInbox';
import MailIcon from '@mui/icons-material/Mail';

import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import theme from "./theme.ts";
import SelectFile from "./components/SelectFile.tsx";
import VideoView from "./components/VideoView.tsx";
import FfmpegTasksQueue from "./stores/FfmpegTasksQueue.ts";
import FfmpegTasksQueueView from "./components/FfmpegTasksQueueView.tsx";


const App = observer(() => {
  const [appStateStore] = useState(() => new AppStateStore())

  return (
    <AppStateStoreContext.Provider value={appStateStore}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme/>
        <Container maxWidth="xl" sx={{paddingTop: 4, minHeight: "100vh", display: "flex", flexDirection: "column"}}>
          {appStateStore.currentVideo ? <VideoView/> : <SelectFile/>}
        </Container>
        <FfmpegTasksQueueView/>
      </ThemeProvider>
    </AppStateStoreContext.Provider>
  );
})

export default App;
