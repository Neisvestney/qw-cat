import {observer} from "mobx-react-lite";
import {useContext} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {Box, Button} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";

const SelectFile = observer(() => {
  const store = useContext(AppStateStoreContext)

  return <Box component="section" sx={{
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flex: "1",
    paddingBottom: 12,
  }}>
    <Button
      variant="outlined"
      size={"large"}
      disabled={store.selectNewVideoFileDisabled}
      loading={store.fileProcessingInfo}
      onClick={store.selectNewVideoFile}
      endIcon={<FolderIcon/>}
    >
      Select video file
    </Button>
  </Box>
})

export default SelectFile;