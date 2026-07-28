# Blockcolc launcher icon

`blockcolc-icon-source.png` is the approved opaque 1254x1254 source artwork.

Android foreground and legacy launcher assets are generated deterministically from this source:

```powershell
python tools\build-adaptive-icon-source.py `
  apps\android\icon-source\blockcolc-icon-source.png `
  artifacts\adaptive-icon `
  --android-res apps\android\android\app\src\main\res `
  --web-icons apps\web\public\icons
```

The script removes only the neutral edge-connected background, preserves the enclosed clock face, fits the subject to the adaptive-icon safe zone, and generates density-specific PNGs. The adaptive background color is `#F3F5F2`.
