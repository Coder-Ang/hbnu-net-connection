// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')
const Store = require('electron-store')
const axios = require('axios')
const https = require('https')
const os = require('os')

// 创建一个 axios 实例，忽略 SSL 证书错误
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  }),
  timeout: 10000
})

// 全局变量
let mainWindow
let tray = null
let autoConnectProcess = null
let isConnected = false
let connectionCheckInterval
let credentials = {}
let logFilePath = path.join(app.getPath('userData'), 'logs')
let currentLogFile = ''

// 初始化存储
const store = new Store()

// 确保日志目录存在
if (!fs.existsSync(logFilePath)) {
  fs.mkdirSync(logFilePath, { recursive: true })
}

// 创建新的日志文件
function createLogFile() {
  const date = new Date()
  const fileName = `log_${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}.txt`
  currentLogFile = path.join(logFilePath, fileName)

  // 写入日志头
  fs.writeFileSync(currentLogFile, `=== 校园网自动连接工具日志 ===\n开始时间: ${date.toLocaleString()}\n\n`, 'utf8')

  return currentLogFile
}

// 写入日志
function writeLog(message, level = 'INFO') {
  if (!currentLogFile) {
    createLogFile()
  }

  const timestamp = new Date().toLocaleString()
  const logMessage = `[${timestamp}] [${level}] ${message}\n`

  // 写入文件
  fs.appendFileSync(currentLogFile, logMessage, 'utf8')

  // 输出到控制台
  console.log(`[${level}] ${message}`)

  // 如果是主窗口存在，发送日志到渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-update', { timestamp, level, message })
  }
}

// 创建主窗口
function createWindow() {
  writeLog('创建主窗口')

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'assets', 'hbnu.webp'),
    show: false // 先不显示，等加载完成后再显示
  })

  // 加载应用的 index.html
  mainWindow.loadFile('index.html')

  // 窗口加载完成后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    writeLog('主窗口已显示')
  })

  // 窗口关闭时的处理
  mainWindow.on('closed', () => {
    mainWindow = null
    writeLog('主窗口已关闭')
  })

  // 窗口最小化时的处理
  mainWindow.on('minimize', (event) => {
    if (store.get('minimizeToTray', true)) {
      event.preventDefault()
      mainWindow.hide()
      writeLog('主窗口已最小化到托盘')
    }
  })
}

// 创建系统托盘
function createTray() {
  writeLog('创建系统托盘')

  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  tray = new Tray(iconPath)

  function updateContextMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
          } else {
            createWindow()
          }
        }
      },
      { type: 'separator' },
      {
        label: isConnected ? '已连接' : '未连接',
        enabled: false
      },
      {
        label: '连接网络',
        enabled: !isConnected && !!credentials.username,
        click: async () => {
          if (credentials.username && credentials.password) {
            writeLog('从托盘菜单触发连接操作')
            await startLogin(credentials)
          } else {
            if (mainWindow) {
              mainWindow.show()
              mainWindow.webContents.send('status-change', {
                connected: false,
                message: '请先设置用户名和密码'
              })
            }
            writeLog('无法连接：未设置用户名和密码', 'WARN')
          }
        }
      },
      {
        label: '断开连接',
        enabled: isConnected,
        click: async () => {
          writeLog('从托盘菜单触发断开连接操作')
          await startLogout()
        }
      },
      { type: 'separator' },
      {
        label: '查看日志',
        click: () => {
          if (fs.existsSync(logFilePath)) {
            require('electron').shell.openPath(logFilePath)
          } else {
            dialog.showMessageBox({
              type: 'info',
              title: '日志',
              message: '日志目录不存在'
            })
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          writeLog('用户从托盘菜单退出应用')
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)
  }

  // 设置工具提示
  tray.setToolTip('校园网自动连接工具')

  // 初始化上下文菜单
  updateContextMenu()

  // 当连接状态改变时更新菜单
  setInterval(updateContextMenu, 2000)

  // 点击托盘图标时的行为
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    } else {
      createWindow()
    }
  })

  return tray
}

// 加载保存的凭据
function loadSavedCredentials() {
  writeLog('加载保存的凭据')
  try {
    const creds = store.get('credentials')
    if (creds) {
      // 如果密码是加密的，这里需要解密
      credentials = creds
      writeLog('成功加载凭据')
      return credentials
    }
  } catch (error) {
    writeLog(`加载凭据失败: ${error.message}`, 'ERROR')
  }
  writeLog('没有找到保存的凭据', 'WARN')
  return null
}

// 保存凭据
function saveCredentials(creds) {
  writeLog('保存凭据')
  try {
    // 这里可以添加加密逻辑
    store.set('credentials', creds)
    credentials = creds
    writeLog('凭据保存成功')
    return true
  } catch (error) {
    writeLog(`保存凭据失败: ${error.message}`, 'ERROR')
    return false
  }
}

// 启动自动化登录进程
async function startLogin(creds) {
  writeLog(`启动登录进程: ${creds.username}`)
  
  // 更新UI状态
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-change', {
      connected: false,
      message: '正在连接...',
      status: 'connecting'
    })
  }
  
  // 保存凭据
  credentials = creds
  store.set('credentials', {
    username: creds.username,
    password: creds.password,
    server: creds.server,
    acId: creds.acId,
    autoConnect: creds.autoConnect
  })
  
  // 如果已经有进程在运行，先终止它
  if (autoConnectProcess) {
    writeLog('终止现有的自动化进程')
    autoConnectProcess.kill()
    autoConnectProcess = null
  }
  
  // 启动自动连接进程
  startAutoConnectProcess()
  
  // 发送登录命令到子进程
  writeLog('发送登录命令到自动化进程')
  autoConnectProcess.send({
    action: 'login',
    credentials: creds
  })
  
  return { success: true, message: '登录进程已启动' }
}

// 启动自动化注销进程
async function startLogout() {
  writeLog('启动注销进程')

  // 更新UI状态
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-change', {
      connected: true,
      message: '正在断开连接...',
      status: 'disconnecting'
    })
  }

  // 如果没有保存的凭据，无法注销
  if (!credentials.username) {
    writeLog('无法注销：未找到用户名', 'WARN')
    return {
      success: false,
      message: '未找到用户名，无法注销'
    }
  }

  // 如果已经有进程在运行，先终止它
  if (autoConnectProcess) {
    writeLog('终止现有的自动化进程')
    autoConnectProcess.kill()
    autoConnectProcess = null
  }

  // 创建子进程
  writeLog('创建自动化子进程')
  autoConnectProcess = fork(path.join(__dirname, 'automation.js'), [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  })

  // 监听子进程消息
  autoConnectProcess.on('message', (message) => {
    if (message.type === 'log') {
      writeLog(`收到自动化进程消息: ${JSON.stringify(message)}`)
      writeLog(message.message, message.level)
    } else if (message.type === 'status') {
      writeLog(`收到自动化进程状态更新: ${JSON.stringify(message)}`)
      isConnected = message.connected

      // 更新主窗口状态
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-status-update', {
          connected: message.connected,
          message: message.message,
          status: message.status
        })
      }
    } else if (message.type === 'progress') {
      // 处理进度消息
      writeLog(`收到自动化进程进度更新: ${message.progress}% - ${message.message}`)

      // 更新主窗口进度
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress-update', {
          progress: message.progress,
          message: message.message
        })
      }
    } else if (message.type === 'result') {
      writeLog(`收到自动化进程结果: ${JSON.stringify(message.result)}`)

      // 处理结果
      if (message.action === 'login') {
        // 登录结果
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('login-result', message.result)
        }
      } else if (message.action === 'logout') {
        // 注销结果
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('logout-result', message.result)
        }
      } else if (message.action === 'check-connection') {
        // 检查连接结果
        isConnected = message.result.connected
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-check-result', message.result)
        }
      }
    } else if (message.type === 'ready') {
      writeLog('自动化进程已准备就绪')
    }
  })

  // 监听子进程退出
  autoConnectProcess.on('exit', (code, signal) => {
    writeLog(`自动连接进程退出，代码: ${code}, 信号: ${signal}`)
    autoConnectProcess = null
  })

  // 监听子进程错误
  autoConnectProcess.on('error', (error) => {
    writeLog(`自动连接进程错误: ${error.message}`, 'ERROR')
  })

  // 发送注销命令到子进程
  writeLog('发送注销命令到自动化进程')
  autoConnectProcess.send({
    action: 'logout',
    credentials: credentials
  })

  return { success: true, message: '注销进程已启动' }
}

// 检查网络连接状态
async function checkConnection() {
  try {
    // 尝试访问多个网站来检查连接
    const sites = [
      'https://www.baidu.com',
      'https://www.qq.com',
      'https://www.163.com'
    ]

    for (const site of sites) {
      try {
        const response = await axiosInstance.get(site, {
          timeout: 5000,
          validateStatus: () => true // 接受任何状态码
        })

        if (response.status >= 200 && response.status < 400) {
          isConnected = true
          return { connected: true, message: '网络已连接' }
        }
      } catch (e) {
        // 继续尝试下一个站点
      }
    }

    // 如果所有站点都访问失败
    isConnected = false
    return { connected: false, message: '网络未连接' }
  } catch (error) {
    isConnected = false
    return { connected: false, message: '网络未连接' }
  }
}

// 开始定期检查连接状态
function startConnectionCheck() {
  writeLog('启动定期连接检查')

  // 先立即检查一次
  checkConnection().then(status => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-change', {
        connected: status.connected,
        message: status.message,
        status: status.connected ? 'connected' : 'disconnected'
      })
    }
  })

  // 设置定期检查
  connectionCheckInterval = setInterval(async () => {
    const status = await checkConnection()

    // 如果状态发生变化，通知渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-change', {
        connected: status.connected,
        message: status.message,
        status: status.connected ? 'connected' : 'disconnected'
      })
    }

    // 如果设置了自动重连且网络断开，尝试重新连接
    if (!status.connected && store.get('autoConnect', false) && credentials.username && credentials.password) {
      writeLog('检测到网络断开，尝试自动重连')
      await startLogin(credentials)
    }
  }, 30000) // 每30秒检查一次
}

// 在 startAutoConnectProcess 函数中添加处理进度消息的代码
function startAutoConnectProcess() {
  if (autoConnectProcess) {
    writeLog('自动连接进程已经在运行')
    return
  }
  
  writeLog('启动自动连接进程')
  
  // 创建子进程
  autoConnectProcess = fork(path.join(__dirname, 'automation.js'))
  
  // 监听子进程消息
  autoConnectProcess.on('message', (message) => {
    if (message.type === 'log') {
      writeLog(message.message, message.level)
    } else if (message.type === 'status') {
      writeLog(`状态更新: ${message.status} - ${message.message}`)
      isConnected = message.connected
      
      // 更新主窗口状态
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-status-update', {
          connected: message.connected,
          message: message.message,
          status: message.status
        })
      }
    } else if (message.type === 'progress') {
      // 处理进度消息
      writeLog(`进度更新: ${message.progress}% - ${message.message}`)
      
      // 更新主窗口进度
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('progress-update', {
            progress: message.progress,
            message: message.message
          })
          writeLog(`已发送进度更新到渲染进程: ${message.progress}%`)
        } catch (error) {
          writeLog(`发送进度更新失败: ${error.message}`, 'ERROR')
        }
      } else {
        writeLog('主窗口不存在或已销毁，无法发送进度更新', 'WARN')
      }
    } else if (message.type === 'result') {
      writeLog(`操作结果: ${message.action} - ${JSON.stringify(message.result)}`)
      
      // 处理结果
      if (message.action === 'login') {
        // 登录结果
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('login-result', message.result)
        }
      } else if (message.action === 'logout') {
        // 注销结果
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('logout-result', message.result)
        }
      } else if (message.action === 'check-connection') {
        // 检查连接结果
        isConnected = message.result.connected
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-check-result', message.result)
        }
      }
    } else if (message.type === 'ready') {
      writeLog('自动化进程已准备就绪')
    }
  })
  
  // 监听子进程退出
  autoConnectProcess.on('exit', (code, signal) => {
    writeLog(`自动连接进程退出，代码: ${code}, 信号: ${signal}`)
    autoConnectProcess = null
  })
  
  // 监听子进程错误
  autoConnectProcess.on('error', (error) => {
    writeLog(`自动连接进程错误: ${error.message}`, 'ERROR')
  })
}

// 获取网络信息
async function getNetworkInfo() {
  try {
    // 获取本地IP地址
    const interfaces = os.networkInterfaces()
    let ip = '未知'
    let mac = '未知'

    // 查找非内部IPv4地址
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ip = iface.address
          mac = iface.mac
          break
        }
      }
      if (ip !== '未知') break
    }

    return {
      ip,
      mac,
      hostname: os.hostname()
    }
  } catch (error) {
    writeLog(`获取网络信息失败: ${error.message}`, 'ERROR')
    return {
      ip: '未知',
      mac: '未知',
      hostname: '未知'
    }
  }
}

// 应用准备就绪时
app.whenReady().then(() => {
  // 创建日志文件
  createLogFile()
  writeLog('应用启动')

  // 注册IPC处理程序
  ipcMain.handle('login', async (event, creds) => {
    writeLog(`收到登录请求: ${creds.username}`)
    return await startLogin(creds)
  })

  ipcMain.handle('logout', async () => {
    writeLog('收到注销请求')
    return await startLogout()
  })

  ipcMain.handle('check-connection', async () => {
    writeLog('收到检查连接请求')
    return await checkConnection()
  })

  ipcMain.handle('save-credentials', async (event, creds) => {
    writeLog(`收到保存凭据请求: ${creds.username}`)
    return saveCredentials(creds)
  })

  ipcMain.handle('load-credentials', async () => {
    writeLog('收到加载凭据请求')
    return loadSavedCredentials()
  })

  ipcMain.handle('get-network-info', async () => {
    writeLog('收到获取网络信息请求')
    return await getNetworkInfo()
  })

  ipcMain.handle('get-logs', async () => {
    writeLog('收到获取日志请求')
    if (currentLogFile && fs.existsSync(currentLogFile)) {
      const logs = fs.readFileSync(currentLogFile, 'utf8')
      return logs
    }
    return ''
  })

  ipcMain.handle('set-auto-launch', async (event, enabled) => {
    writeLog(`设置开机启动: ${enabled}`)
    store.set('autoLaunch', enabled)
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: app.getPath('exe')
    })
    return enabled
  })

  ipcMain.handle('get-auto-launch', async () => {
    const enabled = store.get('autoLaunch', false)
    writeLog(`获取开机启动设置: ${enabled}`)
    return enabled
  })

  ipcMain.handle('set-auto-connect', async (event, enabled) => {
    writeLog(`设置自动重连: ${enabled}`)
    store.set('autoConnect', enabled)
    return enabled
  })

  ipcMain.handle('get-auto-connect', async () => {
    const enabled = store.get('autoConnect', false)
    writeLog(`获取自动重连设置: ${enabled}`)
    return enabled
  })

  ipcMain.handle('set-minimize-to-tray', async (event, enabled) => {
    writeLog(`设置最小化到托盘: ${enabled}`)
    store.set('minimizeToTray', enabled)
    return enabled
  })

  ipcMain.handle('get-minimize-to-tray', async () => {
    const enabled = store.get('minimizeToTray', true)
    writeLog(`获取最小化到托盘设置: ${enabled}`)
    return enabled
  })

  // 添加取消操作的处理函数
  ipcMain.handle('cancel-operation', async () => {
    writeLog('收到取消操作请求')
    
    // 如果有自动连接进程在运行，终止它
    if (autoConnectProcess) {
      writeLog('终止自动连接进程')
      autoConnectProcess.send({ action: 'cancel' })
      
      // 等待进程响应或超时
      const result = await new Promise((resolve) => {
        // 设置超时
        const timeout = setTimeout(() => {
          writeLog('取消操作超时，强制终止进程')
          autoConnectProcess.kill()
          autoConnectProcess = null
          resolve({ success: true, message: '操作已取消（强制终止）' })
        }, 3000)
        
        // 监听进程响应
        const messageHandler = (message) => {
          if (message.type === 'result' && message.action === 'cancel') {
            clearTimeout(timeout)
            autoConnectProcess.removeListener('message', messageHandler)
            resolve(message.result)
          }
        }
        
        autoConnectProcess.on('message', messageHandler)
      })
      
      // 更新UI状态
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-change', {
          connected: false,
          message: '操作已取消',
          status: 'disconnected'
        })
      }
      
      return result
    } else {
      return { success: true, message: '没有正在进行的操作' }
    }
  })

  // 加载保存的凭据
  loadSavedCredentials()

  // 创建窗口
  createWindow()

  // 创建系统托盘
  createTray()

  // 开始连接检查
  startConnectionCheck()

  // 设置开机启动
  app.setLoginItemSettings({
    openAtLogin: store.get('autoLaunch', false),
    path: app.getPath('exe')
  })

  // macOS 特定处理
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 当所有窗口关闭时退出应用，除了在 macOS 上
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// 应用退出时清理
app.on('will-quit', () => {
  writeLog('应用即将退出')

  if (connectionCheckInterval) {
    clearInterval(connectionCheckInterval)
  }

  if (autoConnectProcess) {
    autoConnectProcess.kill()
  }
})

