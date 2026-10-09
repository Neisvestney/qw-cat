import {observer} from "mobx-react-lite";
import {useContext} from "react";
import {Alert, Snackbar} from "@mui/material";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";

// Above the export wizard (1455) and its menus, below the logs window
const Z_INDEX = 1457;

const ExportPresetsErrorSnackbar = observer(() => {
  const appStateStore = useContext(AppStateStoreContext);
  const error = appStateStore.exportPresetsSaveError;

  const handleClose = (_: unknown, reason?: string) => {
    if (reason == "clickaway") return;
    appStateStore.clearExportPresetsSaveError();
  };

  return (
    <Snackbar
      open={error != null}
      autoHideDuration={8000}
      onClose={handleClose}
      // The tasks queue snackbar always sits bottom right
      anchorOrigin={{vertical: "top", horizontal: "center"}}
      sx={{zIndex: Z_INDEX}}
    >
      <Alert severity="error" variant="filled" onClose={handleClose} sx={{width: "100%"}}>
        {`Couldn't save export presets, they will be lost after restart: ${error}`}
      </Alert>
    </Snackbar>
  );
});

export default ExportPresetsErrorSnackbar;
