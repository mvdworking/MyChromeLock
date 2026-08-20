# Chrome Password Lock

Lock Google Chrome with a password on startup and after idle time.

## Features

- Password lock when Chrome starts
- Auto-lock after configurable idle time (1–1440 minutes)
- Manual lock via toolbar icon or **Lock now** in Options
- Custom keyboard shortcut (assign in Chrome settings)
- Secure password storage (PBKDF2-SHA-256 — never stored in plain text)
- Restores previous tabs after unlock

## Install

1. Download the latest source from [Releases](https://github.com/mvdworking/MyChromeLock/releases) or clone this repository
2. Extract the archive (if downloaded as ZIP)
3. Open `chrome://extensions`
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** and select the folder that contains `manifest.json`

## Usage

1. Open the extension **Options** and set a password (minimum 4 characters)
2. Set the idle timeout in minutes
3. Chrome will lock on startup and after idle
4. To lock immediately:
   - Click the extension icon in the toolbar, or
   - Use **Lock now** in Options
5. To set a keyboard shortcut:
   - Open **Options** → click **Assign keyboard shortcut**
   - Find **Chrome Password Lock** → **Lock Chrome**
   - Set your preferred keys (for example `Ctrl+Shift+L`)

> Note: Chrome may not apply the suggested shortcut automatically if it conflicts with another extension or system command. Always confirm it under `chrome://extensions/shortcuts`.

## Version

Current version: **2.2.1**

## License

Use freely for personal purposes.
