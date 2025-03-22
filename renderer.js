/**
 * This file is loaded via the <script> tag in the index.html file and will
 * be executed in the renderer process for that window. No Node.js APIs are
 * available in this process because `nodeIntegration` is turned off and
 * `contextIsolation` is turned on. Use the contextBridge API in `preload.js`
 * to expose Node.js functionality from the main process.
 */

// 获取DOM元素
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const serverInput = document.getElementById('server');
const acIdInput = document.getElementById('ac_id');
const autoConnectCheckbox = document.getElementById('autoConnect');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const connectionStatus = document.getElementById('connectionStatus');
const messageElement = document.getElementById('message');
const autoLaunchCheckbox = document.getElementById('autoLaunch');
const ipAddressElement = document.getElementById('ipAddress');
const macAddressElement = document.getElementById('macAddress');
const hostnameElement = document.getElementById('hostname');

// 获取新的进度条元素
const progressWrapper = document.getElementById('progress-wrapper');
const progressLabel = document.getElementById('progress-label');
const progressBar = document.getElementById('progress-bar');
const progressPercentage = document.getElementById('progress-percentage');

// 全局变量跟踪当前进度
let currentProgress = 0;
let progressHideTimeout = null;

// 页面加载时加载保存的凭据
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const savedCredentials = await window.electronAPI.loadCredentials();
    if (savedCredentials) {
      usernameInput.value = savedCredentials.username || '';
      passwordInput.value = savedCredentials.password || '';
      serverInput.value = savedCredentials.server || '172.16.1.11';
      acIdInput.value = savedCredentials.acId || '1';
      autoConnectCheckbox.checked = savedCredentials.autoConnect || false;
      
      // 如果设置了自动连接，则尝试连接
      if (savedCredentials.autoConnect) {
        await tryLogin();
      }
    }
    
    // 检查当前连接状态
    await checkConnectionStatus();

    // 加载开机启动设置
    const autoLaunch = await window.electronAPI.getAutoLaunch();
    autoLaunchCheckbox.checked = autoLaunch;

    // 更新网络信息
    await updateNetworkInfo();
  } catch (error) {
    updateMessage(`加载设置失败: ${error.message}`);
  }
});

// 登录按钮点击事件
loginBtn.addEventListener('click', async () => {
  await tryLogin();
});

// 注销按钮点击事件
logoutBtn.addEventListener('click', async () => {
  await tryLogout();
});

// 登录函数
async function tryLogin() {
  try {
    console.log('开始登录流程');
    
    // 检查表单数据
    if (!usernameInput.value.trim() || !passwordInput.value.trim()) {
      updateMessage('请输入用户名和密码');
      return;
    }
    
    // 禁用登录和注销按钮，防止重复点击
    loginBtn.disabled = true;
    logoutBtn.disabled = true;
    
    // 更新处理状态，但不改变连接状态
    updateProcessStatus('登录中');
    
    // 保存当前连接状态，以便在登录过程中保持不变
    const currentConnectionState = connectionStatus.textContent;
    
    // 获取表单数据
    const credentials = {
      username: usernameInput.value.trim(),
      password: passwordInput.value.trim(),
      server: serverInput.value.trim(),
      acId: acIdInput.value.trim(),
      autoConnect: autoConnectCheckbox.checked
    };
    
    // 保存凭据
    await window.electronAPI.saveCredentials(credentials);
    
    // 获取内联进度条元素
    const inlineProgress = document.getElementById('inline-progress');
    const inlineProgressText = document.getElementById('inline-progress-text');
    const inlineProgressBar = document.getElementById('inline-progress-bar');
    const inlineProgressPercent = document.getElementById('inline-progress-percent');
    
    // 修改内联进度条样式为绿色（登录）
    inlineProgressBar.style.backgroundColor = '#4CAF50';
    inlineProgressText.style.color = '#4CAF50';
    inlineProgressPercent.style.color = '#4CAF50';
    
    // 显示内联进度条
    inlineProgress.style.display = 'block';
    inlineProgressText.textContent = '准备登录...';
    inlineProgressBar.style.width = '0%';
    inlineProgressPercent.textContent = '0%';
    
    // 发送登录请求
    updateMessage('正在登录...');
    
    // 模拟进度更新
    let loginProgress = 0;
    const progressInterval = setInterval(() => {
      loginProgress += 5;
      if (loginProgress > 90) {
        loginProgress = 90; // 最多到90%，等待实际结果
      }
      
      console.log(`登录进度: ${loginProgress}%`);
      
      // 更新内联进度条
      inlineProgressBar.style.width = `${loginProgress}%`;
      inlineProgressText.textContent = `登录中: ${loginProgress}%`;
      inlineProgressPercent.textContent = `${loginProgress}%`;
    }, 300);
    
    // 发送实际登录请求
    const result = await window.electronAPI.login(credentials);
    
    // 清除进度更新定时器
    clearInterval(progressInterval);
    
    if (result.success) {
      // 更新进度到100%
      inlineProgressBar.style.width = '100%';
      inlineProgressText.textContent = '登录成功';
      inlineProgressPercent.textContent = '100%';
      
      // 只有在登录成功时才更新连接状态
      updateConnectionStatus('已连接');
      updateMessage(result.message);
      updateProcessStatus('成功');
    } else {
      // 更新进度到0%（失败）
      inlineProgressBar.style.width = '0%';
      inlineProgressText.textContent = '登录失败';
      inlineProgressPercent.textContent = '0%';
      
      // 登录失败时恢复原来的连接状态
      updateConnectionStatus(currentConnectionState);
      updateMessage(`登录失败: ${result.message}`);
      updateProcessStatus('失败');
      // 启用按钮
      loginBtn.disabled = false;
      logoutBtn.disabled = false;
    }
    
  } catch (error) {
    console.error('Login error:', error);
    updateMessage(`登录出错: ${error.message}`);
    updateProcessStatus('错误');
    
    // 出错时不改变连接状态，而是重新检查
    checkConnectionStatus();
    
    // 获取内联进度条元素
    const inlineProgress = document.getElementById('inline-progress');
    const inlineProgressText = document.getElementById('inline-progress-text');
    const inlineProgressBar = document.getElementById('inline-progress-bar');
    const inlineProgressPercent = document.getElementById('inline-progress-percent');
    
    if (inlineProgress) {
      // 更新内联进度条显示错误
      inlineProgressBar.style.width = '0%';
      inlineProgressText.textContent = `登录出错: ${error.message}`;
      inlineProgressPercent.textContent = '0%';
    }
    
    // 启用按钮
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
  }
}

// 注销函数
async function tryLogout() {
  try {
    console.log('开始注销流程');
    
    // 禁用登录和注销按钮，防止重复点击
    loginBtn.disabled = true;
    logoutBtn.disabled = true;
    
    // 获取内联进度条元素
    const inlineProgress = document.getElementById('inline-progress');
    const inlineProgressText = document.getElementById('inline-progress-text');
    const inlineProgressBar = document.getElementById('inline-progress-bar');
    const inlineProgressPercent = document.getElementById('inline-progress-percent');
    
    // 修改内联进度条样式为红色（注销）
    inlineProgressBar.style.backgroundColor = '#e74c3c';
    inlineProgressText.style.color = '#e74c3c';
    inlineProgressPercent.style.color = '#e74c3c';
    
    // 显示内联进度条
    inlineProgress.style.display = 'block';
    inlineProgressText.textContent = '准备注销...';
    inlineProgressBar.style.width = '0%';
    inlineProgressPercent.textContent = '0%';
    
    // 发送注销请求
    updateMessage('正在注销...');
    
    // 模拟进度更新
    let logoutProgress = 0;
    const progressInterval = setInterval(() => {
      logoutProgress += 5;
      if (logoutProgress > 90) {
        logoutProgress = 90; // 最多到90%，等待实际结果
      }
      
      console.log(`注销进度: ${logoutProgress}%`);
      
      // 更新内联进度条
      inlineProgressBar.style.width = `${logoutProgress}%`;
      inlineProgressText.textContent = `注销中: ${logoutProgress}%`;
      inlineProgressPercent.textContent = `${logoutProgress}%`;
    }, 300);
    
    // 发送实际注销请求
    const result = await window.electronAPI.logout();
    
    // 清除进度更新定时器
    clearInterval(progressInterval);
    
    if (result.success) {
      // 更新进度到100%
      inlineProgressBar.style.width = '100%';
      inlineProgressText.textContent = '注销成功';
      inlineProgressPercent.textContent = '100%';
      
      updateMessage(result.message);
    } else {
      // 更新进度到0%（失败）
      inlineProgressBar.style.width = '0%';
      inlineProgressText.textContent = '注销失败';
      inlineProgressPercent.textContent = '0%';
      
      updateMessage(`注销失败: ${result.message}`);
      // 启用按钮
      loginBtn.disabled = false;
      logoutBtn.disabled = false;
    }
    
  } catch (error) {
    console.error('Logout error:', error);
    updateMessage(`注销出错: ${error.message}`);
    
    // 获取内联进度条元素
    const inlineProgress = document.getElementById('inline-progress');
    const inlineProgressText = document.getElementById('inline-progress-text');
    const inlineProgressBar = document.getElementById('inline-progress-bar');
    const inlineProgressPercent = document.getElementById('inline-progress-percent');
    
    if (inlineProgress) {
      // 更新内联进度条显示错误
      inlineProgressBar.style.width = '0%';
      inlineProgressText.textContent = `注销出错: ${error.message}`;
      inlineProgressPercent.textContent = '0%';
    }
    
    // 启用按钮
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
  }
}

// 检查连接状态
async function checkConnectionStatus() {
  try {
    console.log('检查连接状态');
    
    // 如果正在进行登录或注销操作，不检查连接状态
    if (document.getElementById('inline-progress').style.display === 'block') {
      console.log('正在进行操作，跳过连接状态检查');
      return;
    }
    
    const result = await window.electronAPI.checkConnection();
    
    if (result.connected) {
      updateConnectionStatus('已连接');
    } else {
      updateConnectionStatus('未连接');
    }
    
    return result.connected;
  } catch (error) {
    console.error('检查连接状态出错:', error);
    return false;
  }
}

// 更新连接状态
function updateConnectionStatus(status) {
  // 如果正在进行操作，且状态为"未连接"，则不更新
  if (document.getElementById('inline-progress').style.display === 'block' && status === '未连接') {
    console.log('正在进行操作，跳过更新连接状态为未连接');
    return;
  }
  
  connectionStatus.textContent = status;
  
  if (status === '已连接') {
    connectionStatus.className = 'connected';
  } else if (status === '连接中') {
    connectionStatus.className = 'connecting';
  } else {
    connectionStatus.className = 'disconnected';
  }
}

// 添加处理状态更新函数
function updateProcessStatus(status) {
  const processStatusElement = document.getElementById('processStatus');
  if (!processStatusElement) return;
  
  processStatusElement.textContent = status;
  
  // 根据状态设置样式
  if (status === '处理中' || status === '登录中' || status === '注销中') {
    processStatusElement.className = 'processing';
  } else if (status === '成功') {
    processStatusElement.className = 'success';
  } else if (status === '失败' || status === '错误') {
    processStatusElement.className = 'error';
  } else {
    processStatusElement.className = '';
  }
}

// 更新消息显示
function updateMessage(message) {
  messageElement.textContent = message;
}

// 修改状态变化监听器，避免自动更新连接状态
window.electronAPI.onStatusChange((event, data) => {
  console.log('Status change:', data);
  
  // 只在特定情况下更新连接状态
  if (data.status === 'connected') {
    updateConnectionStatus('已连接');
  } else if (data.status === 'disconnected' && !document.getElementById('inline-progress').style.display === 'block') {
    // 只有在没有显示进度条时才更新为未连接
    updateConnectionStatus('未连接');
  }
  
  // 始终更新消息
  if (data.message) {
    updateMessage(data.message);
  }
});

// 每30秒检查一次连接状态
setInterval(checkConnectionStatus, 30000);

// 添加开机启动选项的事件监听器
autoLaunchCheckbox.addEventListener('change', async (event) => {
  await window.electronAPI.setAutoLaunch(event.target.checked);
});

// 添加获取网络信息的函数
async function updateNetworkInfo() {
  try {
    const networkInfo = await window.electronAPI.getNetworkInfo();
    ipAddressElement.textContent = networkInfo.ip || '未知';
    macAddressElement.textContent = networkInfo.mac || '未知';
    hostnameElement.textContent = networkInfo.hostname || '未知';
  } catch (error) {
    console.error('Failed to update network info:', error);
  }
}

// 监听进度更新
window.electronAPI.onProgressUpdate((event, data) => {
  console.log('收到进度更新:', data.progress, data.message);
  
  // 获取内联进度条元素
  const inlineProgress = document.getElementById('inline-progress');
  const inlineProgressText = document.getElementById('inline-progress-text');
  const inlineProgressBar = document.getElementById('inline-progress-bar');
  const inlineProgressPercent = document.getElementById('inline-progress-percent');
  
  if (inlineProgress) {
    // 显示内联进度条
    inlineProgress.style.display = 'block';
    
    // 更新内联进度条
    inlineProgressBar.style.width = `${data.progress}%`;
    inlineProgressText.textContent = data.message || '处理中...';
    inlineProgressPercent.textContent = `${data.progress}%`;
  }
});

// 监听登录结果
window.electronAPI.onLoginResult((event, result) => {
  console.log('Login result:', result);
  
  if (result.success) {
    updateConnectionStatus('已连接');
    updateMessage(result.message);
    // 更新网络信息
    updateNetworkInfo();
  } else {
    updateConnectionStatus('未连接');
    updateMessage(result.message);
  }
  
  // 启用按钮
  loginBtn.disabled = false;
  logoutBtn.disabled = false;
});

// 监听注销结果
window.electronAPI.onLogoutResult((event, result) => {
  console.log('Logout result:', result);
  
  if (result.success) {
    updateConnectionStatus('未连接');
    updateMessage(result.message);
  } else {
    // 检查当前连接状态
    checkConnectionStatus();
    updateMessage(result.message);
  }
  
  // 启用按钮
  loginBtn.disabled = false;
  logoutBtn.disabled = false;
});

// 监听连接状态更新
window.electronAPI.onConnectionStatusUpdate((event, data) => {
  if (data.connected) {
    updateConnectionStatus('已连接');
  } else {
    updateConnectionStatus('未连接');
  }
  
  if (data.message) {
    updateMessage(data.message);
  }
});

// 监听连接检查结果
window.electronAPI.onConnectionCheckResult((event, result) => {
  if (result.connected) {
    updateConnectionStatus('已连接');
  } else {
    updateConnectionStatus('未连接');
  }
  
  if (result.message) {
    updateMessage(result.message);
  }
  
  // 如果未连接且设置了自动连接，尝试登录
  if (!result.connected && autoConnectCheckbox.checked) {
    tryLogin();
  }
});

// 移除所有测试按钮和调试按钮
document.querySelectorAll('button[style*="9b59b6"], button[style*="e67e22"], button[style*="3498db"]').forEach(btn => {
  btn.remove();
});

// 修改取消操作的事件监听器
document.getElementById('cancel-operation-btn').addEventListener('click', async function() {
  console.log('取消操作按钮被点击');
  
  try {
    // 获取内联进度条元素
    const inlineProgress = document.getElementById('inline-progress');
    const inlineProgressText = document.getElementById('inline-progress-text');
    const inlineProgressBar = document.getElementById('inline-progress-bar');
    const inlineProgressPercent = document.getElementById('inline-progress-percent');
    const cancelBtn = document.getElementById('cancel-operation-btn');
    
    // 禁用取消按钮，防止重复点击
    cancelBtn.disabled = true;
    cancelBtn.style.opacity = '0.6';
    cancelBtn.style.cursor = 'not-allowed';
    
    // 不改变按钮文本，而是改变进度条文本
    inlineProgressText.textContent = '正在取消...';
    inlineProgressText.style.color = '#f44336';
    
    // 更新进度条状态
    inlineProgressBar.style.backgroundColor = '#f44336';
    inlineProgressPercent.style.color = '#f44336';
    
    // 更新处理状态
    updateProcessStatus('取消中');
    
    // 发送取消请求
    const result = await window.electronAPI.cancelOperation();
    
    // 更新进度条
    inlineProgressText.textContent = '已取消';
    inlineProgressBar.style.width = '100%';
    inlineProgressPercent.textContent = '100%';
    
    // 更新状态消息
    updateMessage(result.message || '操作已取消');
    updateProcessStatus('已取消');
    
    // 启用按钮
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
    
    // 3秒后隐藏进度条
    setTimeout(() => {
      inlineProgress.style.display = 'none';
      
      // 重置取消按钮状态
      cancelBtn.disabled = false;
      cancelBtn.style.opacity = '1';
      cancelBtn.style.cursor = 'pointer';
      
      // 重新检查连接状态
      checkConnectionStatus();
    }, 3000);
  } catch (error) {
    console.error('取消操作出错:', error);
    updateMessage(`取消操作出错: ${error.message}`);
    updateProcessStatus('错误');
    
    // 重置取消按钮状态
    const cancelBtn = document.getElementById('cancel-operation-btn');
    cancelBtn.disabled = false;
    cancelBtn.style.opacity = '1';
    cancelBtn.style.cursor = 'pointer';
    
    // 启用按钮
    loginBtn.disabled = false;
    logoutBtn.disabled = false;
    
    // 重新检查连接状态
    checkConnectionStatus();
  }
});
