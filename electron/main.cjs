const { app, BrowserWindow } = require("electron");
const { fork } = require("child_process");
const { join } = require("path");
const { existsSync } = require("fs");

let mainWindow = null;
let serverProcess = null;

const isDev = !app.isPackaged;

function getStandaloneServerPath() {
  if (!isDev) {
    return join(process.resourcesPath, "app.asar.unpacked", ".next", "standalone", "server.js");
  }
  const localPath = join(__dirname, "..", ".next", "standalone", "server.js");
  if (existsSync(localPath)) return localPath;
  return localPath;
}

async function startNextjsServer() {
  if (isDev) {
    return 3100;
  }

  return new Promise((resolve, reject) => {
    const serverPath = getStandaloneServerPath();
    if (!existsSync(serverPath)) {
      reject(
        new Error(
          `Standalone server not found. Run \`pnpm build:desktop\` first.`
        )
      );
      return;
    }

    const env = {
      ...process.env,
      IS_DESKTOP: "true",
      PORT: "3101",
      HOSTNAME: "127.0.0.1",
    };

    serverProcess = fork(serverPath, [], {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    serverProcess.stdout.on("data", (data) => {
      const text = data.toString();
      const m = text.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });

    serverProcess.stderr.on("data", (data) => {
      const text = data.toString();
      if (text.includes("Error:")) {
        console.error("[next]", text.trim());
      }
    });

    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (code !== 0 && !serverProcess.killed) {
        console.error(`Server exited with code ${code}`);
      }
    });

    setTimeout(() => {
      reject(new Error("Server start timeout (30s)"));
    }, 30000);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "PRM · 人脉管理",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const port = await startNextjsServer();
    console.log(`Next.js server ready on port ${port}`);
    createWindow(port);
  } catch (err) {
    console.error("Failed to start:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("activate", () => {
  if (mainWindow === null && !serverProcess) {
    app.whenReady().then(async () => {
      const port = await startNextjsServer();
      createWindow(port);
    });
  }
});
