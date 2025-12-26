import {observer} from "mobx-react-lite";
import {Link} from "@mui/material";
import {useEffect, useState} from "react";
import semver from "semver";
import {openUrl} from "@tauri-apps/plugin-opener";

const VersionChecker = observer(() => {
  const [latestVersion, setLatestVersion] = useState({
    tag: "",
    isNewer: false
  });

  useEffect(() => {
    fetch("https://api.github.com/repos/Neisvestney/qw-cat/releases/latest").then(r => r.json()).then(r => {
      const latest = semver.clean(r.tag_name) ?? "";
      const current = __APP_VERSION__;
      console.log(`Latest version: ${latest}, current version: ${current}`)
      setLatestVersion({
        tag: r.tag_name ?? "",
        isNewer: semver.gt(latest ?? "", current)
      })
    })
  }, []);

  return <>
    {latestVersion.isNewer &&
        <Link
            sx={{marginBottom: 2}}
            onClick={() => openUrl(`https://github.com/Neisvestney/qw-cat/releases/${latestVersion.tag}`)}
        >
            New version available: {__APP_VERSION__} {'->'} {latestVersion.tag}
        </Link>
    }
  </>
})

export default VersionChecker;