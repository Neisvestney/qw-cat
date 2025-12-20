import {createTheme} from "@mui/material";

import {grey, blue} from '@mui/material/colors';

const theme = createTheme({
  palette: {
    mode: 'dark',
    secondary: {
      light: grey[200],
      main: grey[300],
      dark: grey[400],
    },
  },
});

export default theme;