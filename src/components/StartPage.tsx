import {observer} from "mobx-react-lite";
import {useContext} from "react";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";
import {
  Backdrop,
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import TheatersIcon from "@mui/icons-material/Theaters";
import CatIcon from "mdi-material-ui/Cat";
import VersionChecker from "./VersionChecker.tsx";

const StartPage = observer(() => {
  const store = useContext(AppStateStoreContext);

  return (
    <Grid
      container
      sx={{
        display: "grid",
        width: "100%",
        flex: "1",
      }}
    >
      <Box
        sx={{
          gridRow: 1,
          gridColumn: 1,
        }}
      >
        <Typography
          color={"#171717"}
          fontSize={200}
          lineHeight={0.8}
          component="span"
          noWrap
          sx={{userSelect: "none"}}
        >
          QW CAT
        </Typography>
      </Box>
      <Box
        component="section"
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          paddingBottom: 12,
          gridRow: 1,
          gridColumn: 1,
        }}
      >
        <Card sx={{width: 300}}>
          <CardActionArea
            onClick={store.selectNewVideoFile}
            disabled={store.selectNewVideoFileDisabled}
          >
            <CardContent>
              <Typography gutterBottom variant="h5" component="div">
                Trim video
              </Typography>
              <Stack
                direction={"row"}
                alignItems={"center"}
                justifyContent={"center"}
                spacing={1}
                paddingTop={1}
                paddingBottom={1}
              >
                <CatIcon sx={{fontSize: "80px", fill: "gray"}} />
                <ContentCutIcon sx={{fontSize: "80px", fill: "gray"}} />
                <TheatersIcon sx={{fontSize: "80px", fill: "gray"}} />
              </Stack>
            </CardContent>
            <CardActions sx={{justifyContent: "end"}}>
              <Button
                component={"span"}
                size="small"
                endIcon={<FolderIcon />}
                disabled={store.selectNewVideoFileDisabled}
              >
                Select video file
              </Button>
            </CardActions>
          </CardActionArea>
        </Card>
      </Box>
      <Box
        sx={{
          gridRow: 1,
          gridColumn: 1,
          display: "flex",
          justifyContent: "start",
          alignItems: "end",
        }}
      >
        <VersionChecker />
      </Box>
      <Backdrop
        sx={(theme) => ({color: "#fff", zIndex: theme.zIndex.snackbar + 1})}
        open={store.fileProcessingInfo}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </Grid>
  );
});

export default StartPage;
