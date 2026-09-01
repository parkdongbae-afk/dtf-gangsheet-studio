// DTF GangSheet Studio — Electron 메인 프로세스 (S0 골격)
// S2에서 Vite+React+TS 본셋업 전까지의 최소 빈 창 진입점.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DTF GangSheet Studio',
    show: false,
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));

  // 스모크 테스트용: DTF_SMOKE_TEST=1이면 창 표시 직후 자동 종료 (검증 자동화)
  if (process.env.DTF_SMOKE_TEST) {
    setTimeout(() => app.quit(), 1500);
  }
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
