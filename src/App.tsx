import {useEffect, useState} from "react";
import {observer} from "mobx-react-lite";
import AppStateStore, {AppStateStoreContext} from "./stores/AppStateStore.ts";
import {Container, CssBaseline, ThemeProvider} from "@mui/material";
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import theme from "./theme.ts";
import SelectFile from "./components/SelectFile.tsx";
import VideoView from "./components/VideoView.tsx";
import FfmpegTasksQueueView from "./components/FfmpegTasksQueueView.tsx";
import LogsStore, {LogsStoreContext} from "./stores/LogsStore.ts";
import LogsView from "./components/LogsView.tsx";
import {emit} from "@tauri-apps/api/event";


const App = observer(() => {
  const [appStateStore] = useState(() => new AppStateStore())
  const [logsStore] = useState(() => new LogsStore())

  useEffect(() => {
    emit("frontend-initialized").then(() => {
      console.log("Frontend initialized")
    })
  }, []);

  return (
    <LogsStoreContext.Provider value={logsStore}>
      <AppStateStoreContext.Provider value={appStateStore}>
        <ThemeProvider theme={theme}>
          <CssBaseline enableColorScheme/>
          <Container maxWidth={false} sx={{paddingTop: 4, minHeight: "100vh", display: "flex", flexDirection: "column"}}>
            {appStateStore.currentVideo ? <VideoView/> : <SelectFile/>}
          </Container>
          <FfmpegTasksQueueView/>
          <LogsView/>
        </ThemeProvider>
      </AppStateStoreContext.Provider>
    </LogsStoreContext.Provider>
  );
})

export default App;
