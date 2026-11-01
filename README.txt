BO1 Drop Tracker - build a Windows .exe

1. Install Node.js (https://nodejs.org), LTS version.
2. Open a terminal (Command Prompt or PowerShell) in this folder.
3. Run:  npm install
4. Run:  npm run dist
5. Your .exe will be in the "dist" folder (portable, no installer needed).

To test without building:  npm start

The built program adds an "Always on top" switch at the bottom of the window.
It keeps the tracker above other windows, and it remembers your choice.
That switch only appears in the program, not in a web browser.

Transparent: the "Transparent" switch removes the window background so the tracker floats over
whatever is behind it. The window loses its title bar in this mode, so drag it by the top strip
and use the small - and x buttons at the top right. Turning it on or off reopens the window
(your game stays saved). Turn it off to resize the window with the mouse.

Settings and hotkeys: the gear button at the top opens Settings. Click a hotkey box, press the keys
you want, and the round goes up or down from anywhere, even while a game has focus. Shortcuts need
Ctrl, Alt, Shift or Win unless they are an F key or a numpad key. If another program already uses a
shortcut, Settings says so.

AUTO-DETECT ROUND (Settings, Windows app only)
- Run "npm install" once before "npm start" (this now installs tesseract.js, which reads the numerals).
- The first time it reads a numeral it downloads English language data (a few MB), so it needs internet once.
- It captures your PRIMARY monitor about once a second and reads only the area you set (default: bottom-left).
  Works with borderless or windowed games. Exclusive fullscreen may show a black capture.
- It only looks at screen pixels. It never reads or touches the game.
- A reading must repeat twice in a row before the round changes.
