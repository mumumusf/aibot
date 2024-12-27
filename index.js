const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const path = require('path');
const os = require('os');
puppeteer.use(StealthPlugin());

let globalBrowser = null;
let isBackgroundMode = false;

// 创建命令行输入接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 获取默认的Chrome用户数据目录
function getDefaultUserDataDir() {
    switch (os.platform()) {
        case 'win32':
            return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
        default:
            return path.join(os.homedir(), '.config', 'google-chrome');
    }
}

// 解析代理字符串
function parseProxyString(proxyString) {
    const [ip, port, username, password] = proxyString.split(':');
    return {
        ip,
        port,
        username,
        password,
        fullProxy: `http://${ip}:${port}`
    };
}

// 保活检查函数
async function keepAlive(page) {
    try {
        // 每5分钟刷新一次页面
        setInterval(async () => {
            try {
                if (page && !page.isClosed()) {
                    await page.reload({ waitUntil: 'networkidle0' });
                    console.log('页面刷新成功 -', new Date().toLocaleString());
                }
            } catch (error) {
                console.log('页面刷新失败，尝试重新连接...');
                try {
                    await page.goto('https://www.google.com', { waitUntil: 'networkidle0' });
                } catch (e) {
                    console.error('重连失败:', e);
                }
            }
        }, 5 * 60 * 1000);

        // 每1分钟检查一次连接状态
        setInterval(async () => {
            try {
                if (page && !page.isClosed()) {
                    await page.evaluate(() => document.title);
                    console.log('连接正常 -', new Date().toLocaleString(), isBackgroundMode ? '(后台模式)' : '');
                }
            } catch (error) {
                console.log('检测到连接异常，正在处理...');
            }
        }, 60 * 1000);
    } catch (error) {
        console.error('保活程序出错:', error);
    }
}

async function startBrowser(proxyString) {
    const proxyInfo = parseProxyString(proxyString);
    console.log('使用代理:', proxyInfo.ip, '端口:', proxyInfo.port);
    
    try {
        const userDataDir = getDefaultUserDataDir();
        console.log('使用Chrome配置目录:', userDataDir);

        // 启动浏览器
        globalBrowser = await puppeteer.launch({
            headless: false,
            userDataDir: userDataDir,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                `--proxy-server=${proxyInfo.fullProxy}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-size=1,1',  // 设置窗口初始大小为最小
                '--window-position=0,0',  // 设置窗口位置
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--allow-running-insecure-content'
            ]
        });

        const pages = await globalBrowser.pages();
        const page = pages[0] || await globalBrowser.newPage();

        // 设置代理认证
        await page.authenticate({
            username: proxyInfo.username,
            password: proxyInfo.password
        });

        // 设置窗口大小为正常大小
        await page.setViewport({
            width: 1366,
            height: 768
        });

        // 访问测试网站
        console.log('正在访问测试网站...');
        await page.goto('https://www.google.com', { 
            waitUntil: 'networkidle0',
            timeout: 60000 
        });

        console.log('浏览器已启动，代理连接成功！');
        console.log('提示: 请设置好插件后，按回车键将浏览器切换到后台模式');
        
        // 启动保活机制
        await keepAlive(page);

        // 等待用户按回车
        rl.question('', async () => {
            console.log('正在切换到后台模式...');
            isBackgroundMode = true;
            
            try {
                // 设置窗口为最小尺寸
                await page.setViewport({
                    width: 1,
                    height: 1
                });
                
                // 移动窗口到屏幕边缘
                await page.evaluate(() => {
                    window.resizeTo(1, 1);
                    window.moveTo(-10, -10);
                });
                
                console.log('浏览器已切换到后台模式，插件继续运行中...');
                console.log('提示：如需完全退出程序，请按 Ctrl+C');
            } catch (error) {
                console.error('切换后台模式失败:', error);
            }
        });

        // 监听浏览器意外关闭
        globalBrowser.on('disconnected', () => {
            if (!isBackgroundMode) {
                console.log('浏览器意外关闭，正在重启...');
                setTimeout(() => {
                    startBrowser(proxyString);
                }, 5000);
            }
        });

    } catch (error) {
        console.error('发生错误:', error);
        console.log('5秒后尝试重新启动...');
        setTimeout(() => {
            startBrowser(proxyString);
        }, 5000);
    }
}

// 启动程序
console.log('请输入代理信息（格式：IP:端口:用户名:密码）：');
rl.question('', (proxyString) => {
    if (!proxyString) {
        console.log('请输入有效的代理信息！');
        rl.close();
        return;
    }
    
    startBrowser(proxyString);
    
    // 处理程序退出
    process.on('SIGINT', async () => {
        console.log('正在安全退出程序...');
        if (globalBrowser) {
            await globalBrowser.close();
        }
        rl.close();
        process.exit(0);
    });
}); 