// Launches Electron with ELECTRON_RUN_AS_NODE stripped from the child env.
// VS Code's extension host sets this var to run its own Node code, and it can
// leak into terminals/tools spawned from inside VS Code. If Electron inherits
// it, electron.exe boots as plain Node instead of the real app, so
// require("electron") returns a path string instead of {app, BrowserWindow,
// ipcMain, ...} and main.cjs crashes before a window ever opens.
const { spawn } = require("child_process");

const electronBin = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, ["."], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
