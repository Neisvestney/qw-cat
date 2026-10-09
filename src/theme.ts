import {createTheme} from "@mui/material";

import {blue} from "@mui/material/colors";

declare module "@mui/material/styles" {
  interface TypeBackground {
    dialog: string;
    card: string;
  }
}

const theme = createTheme({
  palette: {
    mode: "dark",
    secondary: {
      light: blue[100],
      main: blue[50],
      dark: blue[200],
    },
    background: {
      dialog: "#1a1a1a",
      card: "#232323",
    },
  },
});

export default theme;
