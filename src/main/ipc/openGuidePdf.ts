/**
 * 번들 PDF 열기 IPC — resources/의 PDF를 시스템 기본 뷰어로 연다 (shell.openPath).
 *
 * - 포토샵 클라우드 가이드: photoshop_cloud_guide.pdf (util:open-guide-pdf)
 * - 사용자 메뉴얼: DTF_사용자_메뉴얼.pdf (util:open-manual-pdf)
 *
 * 경로 해석은 사이드카와 동일한 패키지 분기(export.ts resolveCommand)를 따른다:
 * 패키지 모드 = extraResources로 복사된 process.resourcesPath 루트,
 * 개발 모드 = 프로젝트 resources/ 디렉터리.
 */
import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function resolvePdfPath(pdfName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, pdfName)
    : join(app.getAppPath(), 'resources', pdfName)
}

function registerOpenPdfIpc(channel: string, pdfName: string): void {
  ipcMain.handle(channel, () => {
    const pdfPath = resolvePdfPath(pdfName)
    if (!existsSync(pdfPath)) {
      throw new Error(`PDF를 찾을 수 없습니다: ${pdfPath}`)
    }
    return shell.openPath(pdfPath).then((errorMessage) => {
      // openPath는 성공 시 빈 문자열, 실패 시 오류 메시지를 반환한다 (throw하지 않음)
      if (errorMessage) {
        throw new Error(`PDF 열기 실패: ${errorMessage}`)
      }
    })
  })
}

export function registerGuidePdfIpc(): void {
  registerOpenPdfIpc('util:open-guide-pdf', 'photoshop_cloud_guide.pdf')
  registerOpenPdfIpc('util:open-manual-pdf', 'DTF_사용자_메뉴얼.pdf')
  registerOpenPdfIpc('util:open-licenses', 'THIRD_PARTY_LICENSES.txt')
}
