# M-864D Mixer Controller

## Overview
A web-based control interface for the TOA M-864D Digital Stereo Mixer. Runs as a Node.js server on a PC; tablets and other devices can connect via any browser on the same network to control the mixer in real time.

## Architecture
- **Frontend**: React + TypeScript with Tailwind CSS and shadcn/ui components
- **Backend**: Express.js + TCP client that communicates with the M-864D mixer using its binary External Control Protocol
- **Real-time sync**: WebSocket (`/ws`) broadcasts every state change to all connected browsers
- **Storage**: Mixer IP/port saved in `mixer-config.json` on disk; auto-reconnects on startup
- **Cross-platform**: `start.bat` (Windows) / `start.sh` (Mac/Linux) startup scripts

## Theme & Design
- Dark mixer-style UI (hsl(220 20% 7%) background)
- Orange accent: hsl(30 100% 52%)
- Color-coded channel groups (blue = mono in, purple = stereo in, green = mono out, red = rec out)
- Touch-friendly for tablet use (large hit targets on faders and matrix cells)

## Key Features
- **Connection**: Enter mixer IP + TCP port (default 3000), auto-reconnects on disconnect
- **Channels tab**: Vertical faders for all 16 channels (8 mono in, 2 stereo in, 4 mono out, 2 rec out) with ON/OFF toggle and live level meters
- **Matrix tab**: Input matrix (10 sources × 4 buses) with crosspoint gain control; output matrix (4 buses × 2 rec out)
- **Presets tab**: 16 preset slots with load and save (store) buttons, active preset highlighted
- **Keepalive**: Sends TCP data every 15 seconds to maintain the mixer connection
- **Full state refresh**: Requests all channel/matrix states on connect, then polls every 30 seconds

## Key Files
- `client/src/pages/home.tsx` - Main mixer UI (channels, matrix, presets tabs)
- `server/mixer.ts` - TCP client and state manager for the M-864D
- `server/routes.ts` - REST API + WebSocket server
- `server/index.ts` - Express entry point
- `shared/schema.ts` - Shared types: MixerState, gain tables, helper functions
- `mixer-config.json` - Saved mixer IP/port (auto-created)
- `start.bat` / `start.sh` - Local startup scripts

## M-864D Protocol
- TCP server on port 3000 (configurable)
- Binary framing: `[CMD byte] [length N] [data 0..N-1]`
- CMD bytes: 0x91=fader, 0x92=on/off, 0x94=input matrix, 0x95=crosspoint gain, 0x96=output matrix, 0xF1=preset load, 0xF3=preset store, 0xF0=status request
- On connect: M-864D sends `DF 01 01`; remote must send data at least every ~60s

## API Routes
- `GET /api/state` - Full mixer state
- `GET/POST /api/config` - Read/write mixer IP+port
- `POST /api/connect` - Connect to mixer
- `POST /api/disconnect` - Disconnect
- `POST /api/fader` - Set fader position
- `POST /api/onoff` - Set channel on/off
- `POST /api/matrix/input` - Toggle input matrix crosspoint
- `POST /api/matrix/input-gain` - Set crosspoint gain
- `POST /api/matrix/output` - Toggle output matrix crosspoint
- `POST /api/preset/load` - Load preset
- `POST /api/preset/store` - Store preset
- `GET /api/info` - Server LAN IP + port
- `WS /ws` - WebSocket for real-time state pushes
