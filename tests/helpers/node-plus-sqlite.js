import { DatabaseSync } from 'node:sqlite'

export function createNodePlusSqlite({
  persistOnClose = false,
  maxCursorCellCharacters = Number.POSITIVE_INFINITY,
  maxCursorWindowCharacters = Number.POSITIVE_INFINITY,
  maxCursorCellBytes = Number.POSITIVE_INFINITY,
  maxCursorWindowBytes = Number.POSITIVE_INFINITY
} = {}) {
  const databases = new Map()
  const openDatabases = new Set()
  const getDatabase = (name) => {
    const database = databases.get(name)
    if (!database || !openDatabases.has(name)) throw new Error(`database not open: ${name}`)
    return database
  }
  const run = (callback, success, fail) => {
    queueMicrotask(() => {
      try { success?.(callback()) } catch (error) { fail?.(error) }
    })
  }

  return {
    openDatabase({ name, success, fail }) {
      run(() => {
        if (!databases.has(name)) databases.set(name, new DatabaseSync(':memory:'))
        openDatabases.add(name)
      }, success, fail)
    },
    isOpenDatabase({ name }) { return openDatabases.has(name) },
    closeDatabase({ name, success, fail }) {
      run(() => {
        const database = getDatabase(name)
        openDatabases.delete(name)
        if (!persistOnClose) {
          database.close()
          databases.delete(name)
        }
      }, success, fail)
    },
    transaction({ name, operation, success, fail }) {
      run(() => getDatabase(name).exec(String(operation).toUpperCase()), success, fail)
    },
    executeSql({ name, sql, success, fail }) {
      run(() => {
        const database = getDatabase(name)
        for (const statement of Array.isArray(sql) ? sql : [sql]) database.exec(statement)
      }, success, fail)
    },
    selectSql({ name, sql, success, fail }) {
      run(() => {
        const rows = getDatabase(name).prepare(sql).all()
        let cursorCharacters = 0
        let cursorBytes = 0
        for (const row of rows) {
          for (const value of Object.values(row)) {
            if (typeof value === 'string' && value.length > maxCursorCellCharacters) {
              throw new Error('android.database.sqlite.SQLiteBlobTooBigException: Row too big to fit into CursorWindow')
            }
            if (typeof value === 'string') {
              const valueBytes = Buffer.byteLength(value, 'utf8')
              if (valueBytes > maxCursorCellBytes) {
                throw new Error('android.database.sqlite.SQLiteBlobTooBigException: Row too big to fit into CursorWindow')
              }
              cursorCharacters += value.length
              cursorBytes += valueBytes
            }
          }
        }
        if (cursorCharacters > maxCursorWindowCharacters) {
          throw new Error('android.database.sqlite.SQLiteBlobTooBigException: CursorWindow capacity exceeded')
        }
        if (cursorBytes > maxCursorWindowBytes) {
          throw new Error('android.database.sqlite.SQLiteBlobTooBigException: CursorWindow capacity exceeded')
        }
        return rows
      }, success, fail)
    },
    closeAll() {
      for (const database of databases.values()) database.close()
      openDatabases.clear()
      databases.clear()
    }
  }
}
