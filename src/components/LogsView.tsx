import {observer} from "mobx-react-lite";
import {useContext, useEffect, useState} from "react";
import {LogsStoreContext} from "../stores/LogsStore.ts";
import {Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,} from "@mui/material";
import {LazyLog, ScrollFollow} from "@melloware/react-logviewer";
import c from "ansi-colors";
import {openDevtools} from "../generated/commands.ts";

c.enabled = true;


const LogsView = observer(() => {
  const logsStore = useContext(LogsStoreContext)
  const [boxRef, setBoxRef] = useState<HTMLDivElement | null>(null);
  const [logRef, setLogRef] = useState<LazyLog | null>(null);

  const handleClose = () => logsStore.setLogsWindowOpen(false)

  useEffect(() => {
    if (logsStore.logs.length == 0 || !logRef) return;

    logRef.appendLines([logsStore.lastLine])
  }, [logsStore.logs.length]);

  useEffect(() => {
    if (!logRef) return;

    logRef.appendLines(logsStore.lines)
  }, [logRef]);

  const [boxHeight, setBoxHeight] = useState(0);
  useEffect(() => {
    if (!boxRef) return;

    const onResize = () => setBoxHeight(boxRef.offsetHeight ?? 0);
    onResize()

    boxRef.addEventListener("resize", onResize)

    return () => boxRef.removeEventListener("resize", onResize);
  }, [boxRef]);


  return <>
    <Dialog fullScreen open={logsStore.logsWindowOpen} onClose={handleClose} sx={{zIndex: 1460}}>
      <DialogTitle>Logs</DialogTitle>
      <DialogContent>
        <Box sx={{height: "100%"}} ref={setBoxRef}>
          <div style={{height: boxHeight}}>
            <ScrollFollow
              startFollowing={true}
              render={({follow, onScroll}) => (
                <LazyLog
                  selectableLines
                  enableLineNumbers={true}
                  wrapLines={true}
                  caseInsensitive
                  enableHotKeys
                  enableSearch
                  follow={follow}
                  onScroll={onScroll}
                  external
                  ref={setLogRef}
                />
              )}
            />
          </div>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={openDevtools}>Open devtools</Button>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  </>
})

export default LogsView;