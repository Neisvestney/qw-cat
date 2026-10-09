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
import RecentVideos from "./RecentVideos.tsx";
import useElementSize from "../lib/useElementSize.ts";

const SECTION_PADDING_X = 16;
const SECTION_PADDING_BOTTOM = 96;
const SECTION_GAP = 32;

const StartPage = observer(() => {
  const store = useContext(AppStateStoreContext);
  const [sectionRef, sectionSize] = useElementSize<HTMLElement>();
  const [mainCardRef, mainCardSize] = useElementSize<HTMLDivElement>();

  return (
    <Grid
      container
      sx={{
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateColumns: "minmax(0, 1fr)",
        overflow: "hidden",
        width: "100%",
        // 0px, not 0%: a percent basis in the min-height parent lets the grid grow with its content
        flex: "1 1 0px",
        minHeight: 0,
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
        ref={sectionRef}
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: `${SECTION_GAP}px`,
          paddingX: `${SECTION_PADDING_X}px`,
          paddingBottom: `${SECTION_PADDING_BOTTOM}px`,
          overflow: "hidden",
          gridRow: 1,
          gridColumn: 1,
        }}
      >
        <Card ref={mainCardRef} sx={{width: 300, flexShrink: 0}}>
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
        <RecentVideos
          availableWidth={sectionSize.width - SECTION_PADDING_X * 2}
          availableHeight={
            sectionSize.height - SECTION_PADDING_BOTTOM - mainCardSize.height - SECTION_GAP
          }
        />
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
