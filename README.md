# Throwback Player

A pocket cassette deck for playing, recording, and organizing audio directly in your browser.

**Live:** [https://pewsaipie.github.io/ThrowbackPlayer/](https://pewsaipie.github.io/ThrowbackPlayer/)

The interface is an original, generalized take on a portable audio deck. It is not affiliated with a hardware manufacturer or product line.

## Run locally

```bash
npm install
npm run dev
```

Open the local preview on a phone or desktop. The app can be added to a phone's home screen for a standalone experience.

## Using the deck

- Tap the cassette well—or press **Stop** while already stopped—to open the tray.
- Select an existing cassette, import an audio file, or choose **Create blank cassette**.
- To record, insert a blank or previously recorded cassette, flip to Side A or B, open the REC cover, and press **REC**. Allow microphone access. Press **Stop** or **REC** again to finish; the take is appended to that side.
- Use **Export ZIP** for a cassette backup. Restore a backup by importing its ZIP from the tray.
- Tap **REW** or **FF** to skip tracks; press and hold to wind. Drag the position slider to seek and use the volume slider to set output level.
- Turn **Memory Stop** on to save the current position. Playback or winding stops when it crosses that mark. The marker resets when you insert a different cassette or flip sides.
- Open the tray and choose **Check for app updates**. If an update is ready, choose **Update** to apply it and reload the app; choose **Later** to postpone.

## Features

- Demo cassette with original music generated in the browser
- Local cassette library with import, persistent storage, ZIP export/restore, and delete controls
- Microphone recording onto blank cassettes, with separate Side A and Side B tracks
- Seek, volume control, and memory stop
- Tape counter, animated reels, VU-style meters, and synthesized mechanical sounds
- Tape-type EQ, limiter, speed-stability effect, and generic hiss reduction
- Browser media controls and optional haptic feedback where supported
- Offline app shell; demo music is generated on-device

## Privacy and storage

Imported audio and recordings are stored in this browser's **IndexedDB** and are never uploaded. Use **Export ZIP** to make a backup. Clearing browser site data removes the local library.

Microphone recording requires browser permission. Audio decoding and some platform features depend on browser support and available device storage.

## Stack

Vite + TypeScript + CSS + Canvas + Web Audio. No React.

GitHub Pages deploys from `main` via Actions.

## License

MIT. See `LICENSE`, `NOTICE.md`, and `LICENSE-ASSETS.md`.
