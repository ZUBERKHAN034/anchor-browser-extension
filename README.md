<p align="center">
  <img src="icon128.png" width="128" height="128" alt="Anchor icon">
</p>

<h1 align="center">Anchor Browser Extension</h1>

<p align="center">Sends Chrome, Arc, Brave and Edge downloads to <a href="https://github.com/mansoorkhan96/anchor">Anchor</a>, a native download manager for macOS.</p>

## Features

- **Takes over downloads**: new browser downloads go to Anchor for faster, resumable, multi-connection downloading.
- **Starts Anchor when needed**: if Anchor isn't running, the extension launches it through its native messaging host.
- **Download with Anchor**: a context menu item for any link.
- **Falls back safely**: when Anchor is off or unavailable, the browser downloads the file itself.
- **Toggle**: turn sending on or off from the toolbar popup.

## Requirements

- [Anchor](https://github.com/mansoorkhan96/anchor) installed, with **Take over browser downloads** turned on in Settings > Browser.

## Install

1. Open `chrome://extensions` (or your browser's extensions page).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

The extension talks to Anchor over a local server on `127.0.0.1:47821`.

## License

[MIT](LICENSE)
