const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const net = require('net')

const PRINTER_IP = '192.168.1.213'
const PRINTER_PORT = 9100
const SOCKET_TIMEOUT_MS = 5000

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Nuevo Imperio Burger',
    backgroundColor: '#0B0A0C',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      zoomFactor: 0.9,
      sandbox: false,
    },
  })

  // Quita el menú completamente (ni con Alt).
  mainWindow.setMenu(null)

  const devUrl = 'http://localhost:5173'
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle(
  'print-tcp',
  async (_event, { ip, port, bytesBase64 }) => {
    const targetIp = ip || PRINTER_IP
    const targetPort = Number(port) || PRINTER_PORT

    if (!bytesBase64 || typeof bytesBase64 !== 'string') {
      return { success: false, error: 'Falta bytesBase64' }
    }

    let data
    try {
      data = Buffer.from(bytesBase64, 'base64')
    } catch (e) {
      return { success: false, error: 'Base64 inválido: ' + e.message }
    }

    if (data.length === 0) {
      return { success: false, error: 'Buffer vacío' }
    }

    return new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false

      const done = (result) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(result)
      }

      socket.setTimeout(SOCKET_TIMEOUT_MS)

      socket.connect(targetPort, targetIp, () => {
        socket.write(data, (err) => {
          if (err) return done({ success: false, error: 'Error de escritura: ' + err.message })
          socket.end()
          done({ success: true })
        })
      })

      socket.on('error', (err) => {
        done({ success: false, error: 'Error de conexión: ' + err.message })
      })

      socket.on('timeout', () => {
        done({ success: false, error: 'Timeout (' + SOCKET_TIMEOUT_MS + 'ms) alcanzado' })
      })
    })
  },
)
