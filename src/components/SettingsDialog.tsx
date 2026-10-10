import {observer} from "mobx-react-lite";
import {useContext, useState} from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import {open as openDialog} from "@tauri-apps/plugin-dialog";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {FfmpegSource} from "../generated";

const OptionLabel = observer(({title, hint}: {title: string; hint: string}) => (
  <>
    <Typography>{title}</Typography>
    <Typography variant="body2" color="text.secondary">
      {hint}
    </Typography>
  </>
));

const SettingsDialog = observer(() => {
  const store = useContext(AppStateStoreContext);
  const state = store.ffmpegSettings;
  // Can't be dismissed until a source is picked
  const firstRun = store.ffmpegSourceRequired;

  const [source, setSource] = useState<FfmpegSource>("downloaded");
  const [customDir, setCustomDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSource(state?.settings.source ?? "downloaded");
    setCustomDir(state?.settings.customDir ?? "");
    setError(null);
  };

  const close = () => {
    if (firstRun || saving) return;
    store.closeSettingsDialog();
  };

  const browse = async () => {
    const dir = await openDialog({directory: true, defaultPath: customDir || undefined});
    if (typeof dir == "string") setCustomDir(dir);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await store.saveFfmpegSettings({source, customDir: customDir.trim() || null});
      store.closeSettingsDialog();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={firstRun || store.settingsDialogOpen}
      onClose={close}
      disableEscapeKeyDown={firstRun}
      maxWidth="sm"
      fullWidth
      slotProps={{transition: {onEnter: reset}}}
    >
      <DialogTitle>{firstRun ? "Choose FFmpeg" : "Settings"}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{mb: 2}}>
          {!firstRun
            ? "Which FFmpeg Qw Cat uses for previews and export."
            : state?.systemAvailable
              ? "FFmpeg is already installed on your system. Use it, or download a build tested with Qw Cat?"
              : "Qw Cat needs FFmpeg. Download a build tested with the app, or point to your own?"}
        </DialogContentText>
        <RadioGroup
          value={source}
          onChange={(e) => setSource(e.target.value as FfmpegSource)}
          sx={{gap: 1}}
        >
          <FormControlLabel
            value="downloaded"
            control={<Radio />}
            disabled={saving}
            label={
              <OptionLabel
                title="Download FFmpeg"
                hint={
                  state?.downloadedAvailable
                    ? "Already downloaded"
                    : "Downloaded once into the app data folder"
                }
              />
            }
          />
          <FormControlLabel
            value="system"
            control={<Radio />}
            disabled={saving}
            label={
              <OptionLabel
                title="Use system FFmpeg"
                hint={state?.systemAvailable ? "Found in PATH" : "Not found in PATH"}
              />
            }
          />
          <FormControlLabel
            value="custom"
            control={<Radio />}
            disabled={saving}
            label={<OptionLabel title="Custom folder" hint="A folder with ffmpeg and ffprobe" />}
          />
        </RadioGroup>
        {source == "custom" && (
          <TextField
            fullWidth
            size="small"
            sx={{mt: 1}}
            label="FFmpeg folder"
            value={customDir}
            disabled={saving}
            onChange={(e) => setCustomDir(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton edge="end" onClick={browse} disabled={saving}>
                      <FolderOpenIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
        {error && (
          <Alert severity="error" sx={{mt: 2}}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {!firstRun && (
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button
          onClick={save}
          disabled={saving || (source == "custom" && customDir.trim() == "")}
          variant="contained"
        >
          {firstRun ? "Continue" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default SettingsDialog;
