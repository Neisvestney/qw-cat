import {observer} from "mobx-react-lite";
import {useContext} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {Button} from "@mui/material";

const SelectFile = observer(() => {
  const store = useContext(AppStateStoreContext)

  return <>
    <Button variant="contained" disabled={store.selectNewVideoFileDisabled} loading={store.fileProcessingInfo} onClick={store.selectNewVideoFile}>Select video file</Button>
  </>
})

export default SelectFile;