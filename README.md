# Throwback Player

A pocket studio cassette deck that plays your files.

**Live:** [https://pewsaipie.github.io/ThrowbackPlayer/](https://pewsaipie.github.io/ThrowbackPlayer/)

Inspired by 1980s professional portable recorders (the WM-D6C family). Original chassis. Not affiliated with Sony.

Tap **Play**. Reels move. Hiss sits under the tape. Flip **Dolby**, **Quartz Lock**, **Tape type**. Open the lid and insert your own audio. Arm **Record** and take a field note.

## Run locally

```bash
npm install
npm run dev
```

Then open the preview on your phone. Add to Home Screen for the full-screen PWA.

## What it does

- Play / Pause / Stop with latched keys
- Hold Rewind or FF to wind; tap to skip a track
- Side A / B (tap the badge on the cassette)
- Cassette tray: demo tape, blank tape, your files, recorded takes
- Dolby, tape type EQ, limiter, quartz wow/flutter
- VU meters, mechanical counter, memory stop
- Record from the microphone onto a new take
- Media Session (Android lock-screen controls)
- Offline for the app shell; demo music is generated on device

Nothing is uploaded. User files never leave the browser.

## Stack

Vite + TypeScript + CSS + Canvas + Web Audio. No React.

GitHub Pages deploys from this branch via Actions.

## License

MIT. See `LICENSE`, `NOTICE.md`, and `LICENSE-ASSETS.md`.
