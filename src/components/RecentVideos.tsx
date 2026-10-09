import {observer} from "mobx-react-lite";
import {useContext, useEffect} from "react";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import MovieIcon from "@mui/icons-material/Movie";
import CloseIcon from "@mui/icons-material/Close";
import {AppStateStoreContext} from "../stores/AppStateStore.ts";

const CARD_WIDTH = 180;
const CARD_HEIGHT = 160;
const THUMBNAIL_HEIGHT = 101;
const HEADER_HEIGHT = 32;
const GAP = 16;
const MAX_COLUMNS = 5;

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function formatOpenedAt(openedAt: number) {
  return new Date(openedAt).toLocaleString(undefined, {dateStyle: "short", timeStyle: "short"});
}

function fitCount(available: number, size: number) {
  return Math.max(0, Math.floor((available + GAP) / (size + GAP)));
}

interface RecentVideosProps {
  availableWidth: number;
  availableHeight: number;
}

const RecentVideos = observer(({availableWidth, availableHeight}: RecentVideosProps) => {
  const store = useContext(AppStateStoreContext);

  useEffect(() => {
    store.loadRecentVideos().catch((e) => console.error("Can't load recent videos", e));
  }, [store]);

  const columns = Math.min(MAX_COLUMNS, fitCount(availableWidth, CARD_WIDTH));
  const rows = fitCount(availableHeight - HEADER_HEIGHT, CARD_HEIGHT);
  const videos = store.recentVideos.slice(0, columns * rows);

  if (videos.length == 0) return null;

  const shownColumns = Math.min(columns, videos.length);

  return (
    <Box sx={{width: shownColumns * (CARD_WIDTH + GAP) - GAP}}>
      <Typography
        variant="overline"
        color="text.secondary"
        component="div"
        sx={{height: HEADER_HEIGHT}}
      >
        Recent videos
      </Typography>
      <Box sx={{display: "flex", flexWrap: "wrap", gap: `${GAP}px`}}>
        {videos.map((video) => (
          <Tooltip key={video.path} title={video.path} enterDelay={600}>
            <Card
              sx={{
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                position: "relative",
                "&:hover .remove-recent, & .remove-recent:focus-visible": {opacity: 1},
              }}
            >
              <CardActionArea
                onClick={() => store.openRecentVideo(video.path)}
                disabled={store.selectNewVideoFileDisabled}
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                }}
              >
                {video.thumbnail ? (
                  <CardMedia
                    component="img"
                    image={video.thumbnail}
                    alt=""
                    sx={{height: THUMBNAIL_HEIGHT, objectFit: "cover"}}
                  />
                ) : (
                  <Box
                    sx={{
                      height: THUMBNAIL_HEIGHT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "action.hover",
                    }}
                  >
                    <MovieIcon sx={{fontSize: 48, fill: "gray"}} />
                  </Box>
                )}
                <CardContent sx={{flex: 1, padding: 1, "&:last-child": {paddingBottom: 1}}}>
                  <Typography variant="body2" noWrap>
                    {fileName(video.path)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {formatOpenedAt(video.openedAt)}
                  </Typography>
                </CardContent>
              </CardActionArea>
              <IconButton
                className="remove-recent"
                size="small"
                aria-label="Remove from recent videos"
                onClick={() => store.removeRecentVideo(video.path)}
                sx={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  opacity: 0,
                  transition: "opacity 150ms",
                  bgcolor: "rgba(0, 0, 0, 0.6)",
                  "&:hover": {bgcolor: "rgba(0, 0, 0, 0.8)"},
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Card>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
});

export default RecentVideos;
