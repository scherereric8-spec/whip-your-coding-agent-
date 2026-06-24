# Whip Your Coding Agent

CrackGPT-style fullscreen Electron overlay for whipping slow AI coding agents.

## Features

- Transparent always-on-top overlay — click-through by default
- Physics-based whip with Mixkit crack sounds
- Hold **Alt** + click to strike real code lines beneath the overlay
- Flick the whip handle for automatic cracks
- Karma counter, agent quips, violent impact effects

## Requirements

- Node.js 18+
- Windows (primary target)

## Install & run

```bash
git clone https://github.com/scherereric8-spec/whip-your-coding-agent.git
cd whip-your-coding-agent
npm install
npm start
```

If Electron fails to download, run:

```bash
node node_modules/electron/install.js
```

## Controls

| Action | Effect |
|--------|--------|
| Hold **Alt** + left-click code | Strike the nearest code line |
| Flick whip handle fast | Auto-crack |
| Left-click handle | Crack |
| Right-click handle | Drop whip |
| **Ctrl+Shift+W** | Hide/show overlay |
| **Esc** | Quit |

## Sounds

Whip crack sounds from [Mixkit](https://mixkit.co/free-sound-effects/whip/) (free license).