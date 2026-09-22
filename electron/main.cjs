/**
 * LogoStudio — masaüstü kabuk (Electron).
 *
 * Uygulama tamamen statik: `npm run build` çıktısı olan `dist/` klasörü
 * doğrudan diskten yüklenir (göreli yollar). Node entegrasyonu gerekmez:
 * çizim, bölge motoru ve kayıt (`localStorage`) tarayıcı tarafında çalışır,
 * kayıt Electron'un kullanıcı verisi klasöründe kalıcı olur.
 *
 * Kullanım:
 *   npm run desktop            → kaynaktan çalıştır
 *   npm run desktop:exe        → taşınabilir .exe üret (release/)
 *   npx electron . --smoke     → açılış doğrulaması yap ve çık (CI/test)
 */

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const isSmoke = process.argv.includes('--smoke');
const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

/** Tek pencere; uygulama tek örnekli çalışsın. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setName('LogoStudio');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    show: !isSmoke,
    title: 'LogoStudio — Circle Grid Logo Builder',
    webPreferences: {
      // Uygulama yalnızca DOM + localStorage kullanır; Node erişimi verilmez.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Dış bağlantılar varsa tarayıcıda açılsın, uygulama penceresinde değil.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(indexPath);

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const win = createWindow();

  if (isSmoke) {
    // Açılış doğrulaması: uygulama gerçekten çizildi mi, kayıt çalışıyor mu?
    // Sonuç hem konsola hem geçici klasöre yazılır: paketlenmiş .exe Windows'ta
    // GUI alt sistemiyle üretildiği için konsol çıktısı her zaman görünmez.
    const report = (payload) => {
      const line = JSON.stringify(payload);
      console.log('SMOKE ' + line);
      try {
        fs.writeFileSync(path.join(os.tmpdir(), 'logostudio-smoke.json'), line, 'utf8');
      } catch {
        /* rapor yazılamazsa konsol çıktısı yeterli */
      }
    };

    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(() => {
          const root = document.getElementById('root');
          const storage = (() => {
            try { localStorage.setItem('__smoke', '1'); localStorage.removeItem('__smoke'); return true; }
            catch { return false; }
          })();
          return {
            title: document.title,
            mounted: !!root && root.childElementCount > 0,
            stage: !!document.querySelector('.gd__stage'),
            tools: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Serbest boyut')),
            storage,
            saved: !!localStorage.getItem('logo-builder:griddraw:v2'),
          };
        })()`);
        report(result);
      } catch (error) {
        report({ ok: false, error: error && error.message ? error.message : String(error) });
      }
      app.quit();
    });
    win.webContents.once('did-fail-load', (_event, code, description) => {
      report({ ok: false, error: `yükleme başarısız: ${code} ${description}` });
      app.quit();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
