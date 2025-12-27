import {createTheme} from "@mui/material";

import {blue} from "@mui/material/colors";

const theme = createTheme({
  palette: {
    mode: "dark",
    secondary: {
      light: blue[100],
      main: blue[50],
      dark: blue[200],
    },
  },
});

export default theme;
