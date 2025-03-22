// 自动化子进程 - 处理登录和注销操作
const { chromium } = require('playwright');
const axios = require('axios');
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 创建一个 axios 实例，忽略 SSL 证书错误
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    }),
    timeout: 10000
});

// 发送日志消息到主进程
function sendLog(message, level = 'INFO') {
    process.send({
        type: 'log',
        message,
        level
    });
    console.log(`[${level}] ${message}`);
}

// 发送状态更新到主进程
function sendStatus(connected, message, status) {
    process.send({
        type: 'status',
        connected,
        message,
        status
    });
}

// 发送进度更新到主进程
function sendProgress(progress, message) {
    process.send({
        type: 'progress',
        progress, // 0-100
        message
    });
}

// 检查网络连接状态 - 不影响UI状态
async function checkConnection(silent = false) {
    try {
        // 尝试访问多个网站来检查连接
        const sites = [
            'https://www.baidu.com',
            'https://www.qq.com',
            'https://www.163.com'
        ];
        
        for (const site of sites) {
            try {
                if (!silent) sendLog(`尝试访问 ${site} 检查连接状态`);
                const response = await axiosInstance.get(site, { 
                    timeout: 5000,
                    validateStatus: () => true // 接受任何状态码
                });
                
                if (response.status >= 200 && response.status < 400) {
                    if (!silent) sendLog(`成功访问 ${site}，网络已连接`);
                    return { connected: true, message: '网络已连接' };
                }
            } catch (e) {
                if (!silent) sendLog(`访问 ${site} 失败: ${e.message}`, 'WARN');
                // 继续尝试下一个站点
            }
        }
        
        // 如果所有站点都访问失败
        if (!silent) sendLog('所有站点访问失败，网络未连接', 'WARN');
        return { connected: false, message: '网络未连接' };
    } catch (error) {
        if (!silent) sendLog(`检查连接状态错误: ${error.message}`, 'ERROR');
        return { connected: false, message: '网络未连接' };
    }
}

// 检查并安装 Playwright 浏览器
async function ensurePlaywrightBrowsers() {
    try {
        sendLog('检查 Playwright 浏览器是否已安装...');
        sendProgress(5, '检查浏览器安装...');
        
        // 尝试启动浏览器，如果失败则安装
        try {
            const browser = await chromium.launch({ headless: true });
            await browser.close();
            sendLog('Playwright 浏览器已安装');
            sendProgress(10, '浏览器已安装');
            return true;
        } catch (error) {
            if (error.message.includes("Executable doesn't exist") || 
                error.message.includes("Looks like Playwright")) {
                
                sendLog('Playwright 浏览器未安装，正在安装...', 'WARN');
                sendProgress(5, '正在安装浏览器...');
                
                try {
                    // 执行安装命令
                    execSync('npx playwright install chromium', { stdio: 'inherit' });
                    sendLog('Playwright 浏览器安装成功');
                    sendProgress(10, '浏览器安装成功');
                    return true;
                } catch (installError) {
                    sendLog(`安装 Playwright 浏览器失败: ${installError.message}`, 'ERROR');
                    sendProgress(0, '浏览器安装失败');
                    return false;
                }
            } else {
                sendLog(`检查 Playwright 浏览器时出错: ${error.message}`, 'ERROR');
                sendProgress(0, '浏览器检查失败');
                return false;
            }
        }
    } catch (error) {
        sendLog(`确保 Playwright 浏览器安装时出错: ${error.message}`, 'ERROR');
        sendProgress(0, '浏览器安装检查失败');
        return false;
    }
}

// 使用 Playwright 实现浏览器自动化登录
async function login(credentials) {
    const { username, password, server, acId } = credentials;
    let browser = null;
    
    try {
        // 确保浏览器已安装
        const browsersReady = await ensurePlaywrightBrowsers();
        if (!browsersReady) {
            sendLog('无法确保 Playwright 浏览器已安装，登录失败', 'ERROR');
            sendStatus(false, '浏览器启动失败', 'error');
            sendProgress(0, '浏览器启动失败');
            return { success: false, message: 'Playwright 浏览器未安装或安装失败' };
        }
        
        sendLog('启动无头浏览器');
        sendStatus(false, '正在启动浏览器...', 'connecting');
        sendProgress(15, '正在启动浏览器...');
        
        // 启动浏览器
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        
        sendLog('浏览器已启动');
        sendProgress(20, '浏览器已启动');
        
        // 创建新上下文和页面
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            viewport: { width: 1366, height: 768 },
            ignoreHTTPSErrors: true
        });
        
        const page = await context.newPage();
        
        // 设置超时
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
        
        // 监听控制台消息
        page.on('console', msg => sendLog(`浏览器控制台: ${msg.text()}`));
        
        // 导航到登录页面
        const loginUrl = `http://${server}/srun_portal_pc?ac_id=${acId}&theme=pro`;
        sendLog(`正在导航到 ${loginUrl}`);
        sendProgress(30, '正在打开登录页面...');
        
        try {
            // 使用 Playwright 的导航方法
            await page.goto(loginUrl, { timeout: 60000 });
            
            // 等待页面稳定
            await page.waitForTimeout(5000);
            
            sendLog('页面已加载');
            sendProgress(40, '登录页面已加载');
        } catch (error) {
            sendLog(`导航错误: ${error.message}，尝试使用更简单的方法`, 'WARN');
            sendProgress(35, '导航出错，尝试备用方法...');
            
            try {
                // 尝试使用更简单的方法
                await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                
                // 等待页面稳定
                await page.waitForTimeout(5000);
                sendLog('页面已使用备用方法加载');
                sendProgress(40, '登录页面已加载(备用方法)');
            } catch (retryError) {
                sendLog(`重试导航失败: ${retryError.message}，无法加载登录页面`, 'ERROR');
                sendStatus(false, `无法加载登录页面: ${retryError.message}`, 'error');
                sendProgress(0, '无法加载登录页面');
                await browser.close();
                return { success: false, message: `无法加载登录页面: ${retryError.message}` };
            }
        }
        
        // 检查是否已经登录
        try {
            sendProgress(45, '检查登录状态...');
            // 检查页面标题
            const title = await page.title();
            sendLog(`页面标题: ${title}`);
            
            // 检查是否已经登录
            const isLoggedIn = await page.evaluate(() => {
                // 根据login-success.html的特征检查
                return document.querySelector('#logout') !== null || 
                       document.body.textContent.includes('注销') ||
                       window.location.href.includes('success');
            });
            
            if (isLoggedIn) {
                sendLog('用户已经登录');
                sendStatus(true, '已经登录', 'connected');
                sendProgress(100, '已经登录');
                await browser.close();
                return { success: true, message: '已经登录' };
            }
            
            sendLog('用户未登录，准备填写登录表单');
            sendProgress(50, '准备填写登录表单...');
        } catch (checkError) {
            sendLog(`检查登录状态出错: ${checkError.message}`, 'WARN');
            sendProgress(50, '准备填写登录表单...');
            // 继续尝试登录
        }
        
        // 查找登录表单元素
        sendLog('查找登录表单元素');
        sendProgress(55, '查找登录表单元素...');
        
        try {
            // 等待用户名输入框出现
            await page.waitForSelector('#username', { timeout: 10000 });
            // 等待登录按钮出现
            await page.waitForSelector('#login-account', { timeout: 10000 });
            
            sendLog('找到所有表单元素');
            sendProgress(60, '找到登录表单');
        } catch (selectorError) {
            sendLog(`等待表单元素出错: ${selectorError.message}`, 'ERROR');
            sendProgress(0, '未找到登录表单');
            
            // 尝试截图以便调试
            try {
                const screenshotPath = `form_error_${Date.now()}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                sendLog(`已保存错误截图: ${screenshotPath}`);
            } catch (screenshotError) {
                sendLog(`保存截图失败: ${screenshotError.message}`, 'ERROR');
            }
            
            sendStatus(false, `未找到登录表单元素: ${selectorError.message}`, 'error');
            await browser.close();
            return { success: false, message: `未找到登录表单元素: ${selectorError.message}` };
        }
        
        // 填写表单
        sendLog('开始填写登录表单');
        sendStatus(false, '正在填写登录表单...', 'connecting');
        sendProgress(65, '正在填写用户名和密码...');
        
        try {
            // 清除并填写用户名
            await page.fill('#username', '');
            await page.fill('#username', username);
            
            // 清除并填写密码
            await page.fill('#password', '');
            await page.fill('#password', password);
            
            sendLog('已填写用户名和密码');
            sendProgress(75, '已填写用户名和密码');
            
            // 点击登录按钮
            sendLog('点击登录按钮');
            sendStatus(false, '正在提交登录请求...', 'connecting');
            sendProgress(80, '正在提交登录请求...');
            
            await page.click('#login-account');
            
            // 等待登录响应
            sendProgress(85, '等待登录响应...');
            await page.waitForTimeout(10000);
            
            // 检查是否登录成功
            sendProgress(90, '检查登录结果...');
            const loginSuccess = await page.evaluate(() => {
                // 根据login-success.html的特征检查
                return document.querySelector('#logout') !== null || 
                       document.body.textContent.includes('注销') ||
                       window.location.href.includes('success');
            });
            
            if (loginSuccess) {
                sendLog('登录成功');
                sendStatus(true, '登录成功', 'connected');
                sendProgress(100, '登录成功');
                await browser.close();
                return { success: true, message: '登录成功' };
            } else {
                // 尝试获取错误信息
                const errorMessage = await page.evaluate(() => {
                    const errorElements = document.querySelectorAll('.error, .alert, .message');
                    for (const el of errorElements) {
                        if (el.textContent.trim()) return el.textContent.trim();
                    }
                    return '未知错误';
                });
                
                sendLog(`登录失败: ${errorMessage}`, 'ERROR');
                sendStatus(false, `登录失败: ${errorMessage}`, 'error');
                sendProgress(0, `登录失败: ${errorMessage}`);
                
                // 尝试截图以便调试
                try {
                    const screenshotPath = `login_failed_${Date.now()}.png`;
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    sendLog(`已保存失败截图: ${screenshotPath}`);
                } catch (screenshotError) {
                    sendLog(`保存截图失败: ${screenshotError.message}`, 'ERROR');
                }
                
                await browser.close();
                return { success: false, message: `登录失败: ${errorMessage}` };
            }
        } catch (formError) {
            sendLog(`操作表单元素失败: ${formError.message}`, 'ERROR');
            sendStatus(false, `操作表单元素失败: ${formError.message}`, 'error');
            sendProgress(0, `操作表单元素失败: ${formError.message}`);
            
            // 尝试截图以便调试
            try {
                const screenshotPath = `form_error_${Date.now()}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                sendLog(`已保存错误截图: ${screenshotPath}`);
            } catch (screenshotError) {
                sendLog(`保存截图失败: ${screenshotError.message}`, 'ERROR');
            }
            
            await browser.close();
            return { success: false, message: `操作表单元素失败: ${formError.message}` };
        }
    } catch (error) {
        sendLog(`登录过程出错: ${error.message}`, 'ERROR');
        sendStatus(false, `登录出错: ${error.message}`, 'error');
        sendProgress(0, `登录出错: ${error.message}`);
        
        if (browser) {
            await browser.close();
        }
        
        return { success: false, message: `登录出错: ${error.message}` };
    }
}

// 使用 Playwright 实现浏览器自动化注销
async function logout(credentials) {
    const { server, acId } = credentials;
    let browser = null;
    
    try {
        // 确保浏览器已安装
        const browsersReady = await ensurePlaywrightBrowsers();
        if (!browsersReady) {
            sendLog('无法确保 Playwright 浏览器已安装，注销失败', 'ERROR');
            sendStatus(true, '浏览器启动失败', 'error');
            sendProgress(0, '浏览器启动失败');
            return { success: false, message: 'Playwright 浏览器未安装或安装失败' };
        }
        
        sendLog('启动无头浏览器进行注销');
        sendProgress(10, '正在启动浏览器...');
        
        // 启动浏览器
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        
        sendLog('浏览器已启动');
        sendProgress(20, '浏览器已启动');
        
        // 创建新上下文和页面
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            viewport: { width: 1366, height: 768 },
            ignoreHTTPSErrors: true
        });
        
        const page = await context.newPage();
        
        // 设置超时
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
        
        // 监听控制台消息
        page.on('console', msg => sendLog(`浏览器控制台(注销): ${msg.text()}`));
        
        // 尝试方法1: 直接访问成功页面并点击注销按钮
        try {
            const successUrl = `http://${server}/srun_portal_success?ac_id=${acId}&theme=pro`;
            sendLog(`访问成功页面: ${successUrl}`);
            sendProgress(30, '正在访问成功页面...');
            
            await page.goto(successUrl, { timeout: 30000 });
            await page.waitForTimeout(3000);
            
            // 检查是否有注销按钮
            const hasLogoutButton = await page.evaluate(() => {
                return document.querySelector('#logout') !== null;
            });
            
            if (hasLogoutButton) {
                sendLog('找到注销按钮 (#logout)，点击注销');
                sendProgress(50, '找到注销按钮，正在点击...');
                await page.click('#logout');
                
                // 等待注销完成
                sendProgress(70, '等待注销完成...');
                await page.waitForTimeout(5000);
                
                // 检查是否注销成功
                sendProgress(80, '检查注销结果...');
                const connectionStatus = await checkConnection(true); // 静默检查
                
                if (!connectionStatus.connected) {
                    sendLog('通过点击注销按钮成功注销');
                    sendStatus(false, '注销成功', 'disconnected');
                    sendProgress(100, '注销成功');
                    await browser.close();
                    return { success: true, message: '注销成功' };
                } else {
                    sendLog('点击注销按钮后仍然连接状态', 'WARN');
                    sendProgress(40, '注销按钮点击失败，尝试其他方法...');
                    // 继续尝试其他方法
                }
            } else {
                sendLog('在成功页面未找到注销按钮 (#logout)', 'WARN');
                sendProgress(40, '未找到注销按钮，尝试其他方法...');
                // 继续尝试其他方法
            }
        } catch (successPageError) {
            sendLog(`访问成功页面出错: ${successPageError.message}`, 'WARN');
            sendProgress(40, '访问成功页面失败，尝试其他方法...');
            // 继续尝试其他方法
        }
        
        // 尝试方法2: 直接访问注销URL
        try {
            const logoutUrl = `http://${server}/cgi-bin/srun_portal?action=logout`;
            sendLog(`直接访问注销URL: ${logoutUrl}`);
            sendProgress(50, '正在直接访问注销URL...');
            
            await page.goto(logoutUrl, { timeout: 30000 });
            await page.waitForTimeout(5000);
            
            // 检查是否注销成功
            sendProgress(70, '检查注销结果...');
            const connectionStatus = await checkConnection(true); // 静默检查
            
            if (!connectionStatus.connected) {
                sendLog('通过访问注销URL成功注销');
                sendStatus(false, '注销成功', 'disconnected');
                sendProgress(100, '注销成功');
                await browser.close();
                return { success: true, message: '注销成功' };
            } else {
                sendLog('访问注销URL后仍然连接状态', 'WARN');
                sendProgress(60, '直接访问注销URL失败，尝试API方法...');
                // 继续尝试其他方法
            }
        } catch (logoutUrlError) {
            sendLog(`访问注销URL出错: ${logoutUrlError.message}`, 'WARN');
            sendProgress(60, '访问注销URL失败，尝试API方法...');
            // 继续尝试其他方法
        }
        
        // 尝试方法3: 使用API注销
        try {
            const apiLogoutUrl = `http://${server}/cgi-bin/srun_portal?action=logout&ajax=1&ac_id=${acId}&_=${Date.now()}`;
            sendLog(`尝试使用API注销: ${apiLogoutUrl}`);
            sendProgress(70, '正在使用API注销...');
            
            const response = await page.goto(apiLogoutUrl, { timeout: 30000 });
            const responseText = await response.text();
            sendLog(`API注销响应: ${responseText}`);
            
            await page.waitForTimeout(5000);
            
            // 检查是否注销成功
            sendProgress(90, '检查注销结果...');
            const connectionStatus = await checkConnection(true); // 静默检查
            
            if (!connectionStatus.connected) {
                sendLog('通过API注销成功');
                sendStatus(false, '注销成功', 'disconnected');
                sendProgress(100, '注销成功');
                await browser.close();
                return { success: true, message: '注销成功' };
            } else {
                sendLog('API注销后仍然连接状态', 'ERROR');
                sendProgress(0, 'API注销失败');
                // 所有方法都失败
            }
        } catch (apiError) {
            sendLog(`API注销出错: ${apiError.message}`, 'ERROR');
            sendProgress(0, 'API注销出错');
            // 所有方法都失败
        }
        
        // 如果所有方法都失败，返回失败
        sendStatus(true, '注销失败', 'error');
        sendProgress(0, '注销失败，尝试了所有可能的方法');
        await browser.close();
        return { success: false, message: '注销失败，尝试了所有可能的方法' };
    } catch (error) {
        sendLog(`注销过程出错: ${error.message}`, 'ERROR');
        sendStatus(true, `注销出错: ${error.message}`, 'error');
        sendProgress(0, '注销过程出错');
        
        if (browser) {
            await browser.close();
        }
        
        return { success: false, message: `注销出错: ${error.message}` };
    }
}

// 监听来自主进程的消息
process.on('message', async (message) => {
    if (message.action === 'login') {
        sendLog(`收到登录请求: ${message.credentials.username}`);
        // 重置进度条
        sendProgress(0, '准备登录...');
        const result = await login(message.credentials);
        process.send({ type: 'result', action: 'login', result });
    } else if (message.action === 'logout') {
        sendLog(`收到注销请求: ${message.credentials.username}`);
        // 重置进度条
        sendProgress(0, '准备注销...');
        const result = await logout(message.credentials);
        process.send({ type: 'result', action: 'logout', result });
    } else if (message.action === 'check-connection') {
        sendLog('收到检查连接请求');
        // 不显示进度条，只返回结果
        const result = await checkConnection();
        process.send({ type: 'result', action: 'check-connection', result });
    } else if (message.action === 'cancel') {
        // 处理取消操作请求
        log('收到取消操作请求')
        
        // 取消当前操作
        isCancelled = true
        
        // 发送取消结果
        process.send({
            type: 'result',
            action: 'cancel',
            result: {
                success: true,
                message: '操作已取消'
            }
        })
        
        // 更新状态
        process.send({
            type: 'status',
            connected: false,
            message: '操作已取消',
            status: 'disconnected'
        })
    }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    sendLog(`未捕获的异常: ${error.message}`, 'ERROR');
    sendLog(error.stack, 'ERROR');
    sendProgress(0, '发生未捕获的异常');
});

// 处理未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
    sendLog(`未处理的 Promise 拒绝: ${reason}`, 'ERROR');
    sendProgress(0, '发生未处理的 Promise 拒绝');
});

// 通知主进程子进程已启动
process.send({ type: 'ready' });
sendLog('自动化子进程已启动');

// 添加一个全局变量跟踪是否取消
let isCancelled = false

// 在关键操作前检查是否取消
function checkCancelled() {
    if (isCancelled) {
        throw new Error('操作已取消')
    }
}
