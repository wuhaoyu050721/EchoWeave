import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createImageExportFileName,
  createJsonExportFileName,
  downloadImageInBrowser,
  exportBytesToDownloads,
  exportTextToDownloads,
  saveImageToPhotoAlbum
} from '../src/platform/app/app-file-exporter.js'

test('writes JSON text to the App public downloads directory without Blob', async () => {
  let requestedType = null
  let requestedName = null
  let requestedOptions = null
  let writtenContent = null
  const writerOperations = []

  const plusApi = {
    io: {
      PUBLIC_DOWNLOADS: 4,
      requestFileSystem(type, success) {
        requestedType = type
        success({
          root: {
            getFile(name, options, onFile) {
              requestedName = name
              requestedOptions = options
              onFile({
                fullPath: `/storage/emulated/0/Download/${name}`,
                createWriter(onWriter) {
                  const writer = {
                    truncate(size) {
                      writerOperations.push(['truncate', size])
                      queueMicrotask(() => writer.onwriteend?.())
                    },
                    seek(position) { writerOperations.push(['seek', position]) },
                    write(content) {
                      writerOperations.push(['write', content])
                      writtenContent = content
                      queueMicrotask(() => writer.onwriteend?.())
                    }
                  }
                  onWriter(writer)
                }
              })
            }
          }
        })
      }
    }
  }

  const path = await exportTextToDownloads({ plusApi, fileName: 'backup.json', content: '{"ok":true}' })

  assert.equal(requestedType, 4)
  assert.equal(requestedName, 'backup.json')
  assert.deepEqual(requestedOptions, { create: true, exclusive: false })
  assert.equal(writtenContent, '{"ok":true}')
  assert.deepEqual(writerOperations.map(operation => operation[0]), ['truncate', 'seek', 'write'])
  assert.equal(path, '/storage/emulated/0/Download/backup.json')
})

test('truncates an existing longer JSON file before writing shorter content', async () => {
  let stored = '{"obsolete":"content that must disappear"}'
  let position = 0
  const plusApi = {
    io: {
      PUBLIC_DOWNLOADS: 4,
      requestFileSystem(_type, success) {
        success({ root: { getFile(_name, _options, onFile) {
          onFile({
            fullPath: '/storage/emulated/0/Download/backup.json',
            createWriter(onWriter) {
              const writer = {
                truncate(size) { stored = stored.slice(0, size); queueMicrotask(() => writer.onwriteend?.()) },
                seek(value) { position = value },
                write(value) {
                  const text = String(value)
                  stored = stored.slice(0, position) + text + stored.slice(position + text.length)
                  queueMicrotask(() => writer.onwriteend?.())
                }
              }
              onWriter(writer)
            }
          })
        } } })
      }
    }
  }

  await exportTextToDownloads({ plusApi, fileName: 'backup.json', content: '{}' })
  assert.equal(stored, '{}')
})

test('creates collision-resistant JSON names and rejects unavailable App file APIs', async () => {
  assert.equal(
    createJsonExportFileName(new Date('2026-07-16T04:05:06.000Z')),
    'ai-chat-backup-2026-07-16-040506.json'
  )
  await assert.rejects(exportTextToDownloads({ plusApi: {}, fileName: 'backup.json', content: '{}' }), /文件导出能力/)
  await assert.rejects(exportTextToDownloads({ plusApi: { io: { PUBLIC_DOWNLOADS: 4, requestFileSystem() {} } }, fileName: '../backup.json', content: '{}' }), /文件名无效/)
})

test('requests legacy public-storage permission before exporting on Android 9 and older', async () => {
  let requestedPermissions = null
  let fileSystemRequested = false
  const plusApi = {
    os: { version: '9' },
    android: {
      requestPermissions(permissions, success) {
        requestedPermissions = permissions
        success({ granted: permissions, deniedPresent: [], deniedAlways: [] })
      }
    },
    io: {
      PUBLIC_DOWNLOADS: 4,
      requestFileSystem(_type, success) {
        fileSystemRequested = true
        success({
          root: {
            getFile(_name, _options, onFile) {
              onFile({
                fullPath: '/storage/emulated/0/Download/backup.json',
                createWriter(onWriter) {
                  const writer = {
                    truncate() { queueMicrotask(() => writer.onwriteend?.()) },
                    seek() {},
                    write() { queueMicrotask(() => writer.onwriteend?.()) }
                  }
                  onWriter(writer)
                }
              })
            }
          }
        })
      }
    }
  }

  await exportTextToDownloads({ plusApi, fileName: 'backup.json', content: '{}' })
  assert.deepEqual(requestedPermissions, ['android.permission.WRITE_EXTERNAL_STORAGE'])
  assert.equal(fileSystemRequested, true)

  plusApi.android.requestPermissions = (_permissions, success) => success({ deniedAlways: ['android.permission.WRITE_EXTERNAL_STORAGE'] })
  await assert.rejects(exportTextToDownloads({ plusApi, fileName: 'backup.json', content: '{}' }), /需要存储权限/)
})

test('writes raw PNG bytes to Downloads without image re-encoding', async () => {
  const source = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  let writtenBlob = null
  const operations = []
  const plusApi = {
    io: {
      PUBLIC_DOWNLOADS: 4,
      requestFileSystem(_type, success) {
        success({
          root: {
            getFile(name, options, onFile) {
              assert.equal(name, 'card.png')
              assert.deepEqual(options, { create: true, exclusive: false })
              onFile({
                fullPath: '/storage/emulated/0/Download/card.png',
                createWriter(onWriter) {
                  const writer = {
                    truncate(size) { operations.push(['truncate', size]); queueMicrotask(() => writer.onwriteend?.()) },
                    seek(position) { operations.push(['seek', position]) },
                    write(value) { writtenBlob = value; operations.push(['write']); queueMicrotask(() => writer.onwriteend?.()) }
                  }
                  onWriter(writer)
                }
              })
            }
          }
        })
      }
    }
  }

  const path = await exportBytesToDownloads({
    plusApi,
    fileName: 'card.png',
    bytes: source,
    mimeType: 'image/png'
  })

  assert.equal(path, '/storage/emulated/0/Download/card.png')
  assert.equal(writtenBlob.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await writtenBlob.arrayBuffer())], [...source])
  assert.deepEqual(operations.map(operation => operation[0]), ['truncate', 'seek', 'write'])
})

test('prefers the Android native Downloads writer and preserves the selected byte range', async () => {
  const backing = Uint8Array.from([99, 0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 99])
  const source = new DataView(backing.buffer, 1, 7)
  const received = []
  const nativeApi = {
    aiChatWriteDownloadFile(options) {
      received.push(options)
      if (options.operation === 'begin') options.success({ sessionId: 'session-42', filePath: '', byteSize: 0 })
      else if (options.operation === 'append') options.success({ sessionId: options.sessionId, filePath: '', byteSize: 7 })
      else options.success({
          sessionId: options.sessionId,
          filePath: 'content://media/external/downloads/42',
          uri: 'content://media/external/downloads/42',
          byteSize: 7
        })
    }
  }

  const path = await exportBytesToDownloads({
    plusApi: {},
    nativeApi,
    fileName: 'card.png',
    bytes: source,
    mimeType: 'image/png'
  })

  assert.equal(path, 'content://media/external/downloads/42')
  assert.deepEqual(received.map(item => item.operation), ['begin', 'append', 'commit'])
  assert.equal(received[0].fileName, 'card.png')
  assert.equal(received[0].mimeType, 'image/png')
  assert.equal(received[0].totalBytes, 7)
  assert.equal(received[1].sessionId, 'session-42')
  assert.equal(received[1].base64, 'iVBORwECAw==')
})

test('streams large native exports in bounded Base64 chunks', async () => {
  const source = new Uint8Array(768 * 1024 + 2)
  source[source.length - 2] = 1
  source[source.length - 1] = 2
  const appendLengths = []
  const nativeApi = {
    aiChatWriteDownloadFile(options) {
      if (options.operation === 'append') appendLengths.push(options.base64.length)
      options.success({
        sessionId: options.sessionId || 'chunk-session',
        filePath: options.operation === 'commit' ? '/downloads/large.png' : '',
        byteSize: source.length
      })
    }
  }

  const path = await exportBytesToDownloads({
    nativeApi,
    fileName: 'large.png',
    bytes: source,
    mimeType: 'image/png'
  })

  assert.equal(path, '/downloads/large.png')
  assert.deepEqual(appendLengths, [1024 * 1024, 4])
})

test('surfaces native Downloads writer errors with their UTS message', async () => {
  await assert.rejects(
    exportBytesToDownloads({
      plusApi: {},
      nativeApi: {
        aiChatWriteDownloadFile(options) {
          options.fail({ errCode: 9101102, errMsg: '没有下载目录写入权限' })
        }
      },
      fileName: 'card.png',
      bytes: Uint8Array.of(1),
      mimeType: 'image/png'
    }),
    /没有下载目录写入权限/
  )
})

test('creates a safe timestamped image name from attachment metadata', () => {
  assert.equal(
    createImageExportFileName(
      { name: 'generated image.jpeg', mimeType: 'image/jpeg' },
      new Date('2026-07-16T04:05:06.000Z')
    ),
    'generated-image-20260716-040506.jpg'
  )
  assert.equal(
    createImageExportFileName({ name: '../', mimeType: 'image/png' }, new Date('2026-07-16T04:05:06.000Z')),
    'ai-chat-image-20260716-040506.png'
  )
})

test('decodes a data URL to a temporary App image and saves it to the system photo album', async () => {
  let bitmapId = ''
  let loadedDataUrl = ''
  let bitmapSave = null
  let bitmapCleared = false
  let albumPath = ''
  let removedPath = ''

  class Bitmap {
    constructor(id) { bitmapId = id }
    loadBase64Data(value, success) { loadedDataUrl = value; success() }
    save(path, options, success) { bitmapSave = { path, options }; success({ target: path }) }
    clear() { bitmapCleared = true }
  }

  const plusApi = {
    os: { name: 'Android', version: '16' },
    nativeObj: { Bitmap },
    io: {
      resolveLocalFileSystemURL(path, success) {
        removedPath = path
        success({ remove(done) { done() } })
      }
    }
  }
  const uniApi = {
    saveImageToPhotosAlbum({ filePath, success }) {
      albumPath = filePath
      success()
    }
  }

  const path = await saveImageToPhotoAlbum({
    plusApi,
    uniApi,
    fileName: 'generated.png',
    dataUrl: 'data:image/png;base64,AA=='
  })

  assert.match(bitmapId, /^image-export-/)
  assert.equal(loadedDataUrl, 'data:image/png;base64,AA==')
  assert.deepEqual(bitmapSave, { path: '_doc/generated.png', options: { overwrite: true } })
  assert.equal(albumPath, '_doc/generated.png')
  assert.equal(path, '_doc/generated.png')
  assert.equal(bitmapCleared, true)
  assert.equal(removedPath, '_doc/generated.png')
})

test('downloads a remote App image before saving it to the photo album', async () => {
  let downloadedUrl = ''
  let albumPath = ''
  const plusApi = { os: { name: 'Android', version: '16' } }
  const uniApi = {
    downloadFile({ url, success }) {
      downloadedUrl = url
      success({ statusCode: 200, tempFilePath: '_doc/uniapp-temp/image.png' })
    },
    saveImageToPhotosAlbum({ filePath, success }) {
      albumPath = filePath
      success()
    }
  }

  const path = await saveImageToPhotoAlbum({
    plusApi,
    uniApi,
    fileName: 'remote.png',
    sourceUrl: 'https://cdn.example.com/image.png'
  })

  assert.equal(downloadedUrl, 'https://cdn.example.com/image.png')
  assert.equal(albumPath, '_doc/uniapp-temp/image.png')
  assert.equal(path, '_doc/uniapp-temp/image.png')
})

test('reports missing native photo-album support instead of silently succeeding', async () => {
  const plusApi = { os: { name: 'Android', version: '16' } }
  const uniApi = {
    downloadFile({ success }) { success({ statusCode: 200, tempFilePath: '_doc/image.png' }) }
  }

  await assert.rejects(saveImageToPhotoAlbum({
    plusApi,
    uniApi,
    fileName: 'remote.png',
    sourceUrl: 'https://cdn.example.com/image.png'
  }), /系统相册保存能力/)
})

test('starts a browser image download with a safe anchor', () => {
  let appended = null
  let clicked = false
  let removed = false
  const anchor = {
    style: {},
    click() { clicked = true },
    remove() { removed = true }
  }
  const documentApi = {
    createElement(tagName) { assert.equal(tagName, 'a'); return anchor },
    body: { appendChild(value) { appended = value } }
  }

  const result = downloadImageInBrowser({
    documentApi,
    fileName: 'generated.png',
    dataUrl: 'data:image/png;base64,AA=='
  })

  assert.equal(result, 'generated.png')
  assert.equal(anchor.href, 'data:image/png;base64,AA==')
  assert.equal(anchor.download, 'generated.png')
  assert.equal(anchor.rel, 'noopener')
  assert.equal(appended, anchor)
  assert.equal(clicked, true)
  assert.equal(removed, true)
})
