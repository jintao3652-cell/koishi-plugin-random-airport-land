import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

export type AirportLevel = '3C' | '4C' | '4D' | '4E' | '4F'

export interface Airport {
  icao: string
  name: string
  iata: string
  lat: number
  lon: number
  level?: AirportLevel
}

export interface RunwayInfo {
  designator: string
  length: number
  width: number
  bearing?: number
}

function dataFile(name: string): string {
  // 数据文件位于插件根目录；打包后 __dirname 指向 lib，因此优先向上一级查找
  const root = resolve(__dirname, '..', name)
  return existsSync(root) ? root : resolve(__dirname, name)
}

function readGbk(path: string): string {
  const buffer = readFileSync(path)
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

/** 轻量 CSV 解析：支持引号、转义引号与 CRLF */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }

  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function records(path: string): Array<Record<string, string>> {
  const rows = parseCsv(readGbk(path))
  if (!rows.length) return []
  const header = rows[0].map((name) => name.trim())
  const output: Array<Record<string, string>> = []
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index]
    if (!cells.length) continue
    const record: Record<string, string> = {}
    for (let column = 0; column < header.length; column++) {
      record[header[column]] = (cells[column] ?? '').trim()
    }
    output.push(record)
  }
  return output
}

/** 解析 NAIP 坐标格式：N400421 / E1163551 → 十进制度 */
export function parseCoordinate(coordinate: string): number {
  if (!coordinate || coordinate.length < 2) {
    throw new Error(`无效坐标格式: ${coordinate}`)
  }

  const hemisphere = coordinate[0]
  const numPart = coordinate.slice(1)
  const isLongitude = numPart.length >= 7

  const degrees = parseInt(isLongitude ? numPart.substring(0, 3) : numPart.substring(0, 2), 10)
  const minutes = parseInt(isLongitude ? numPart.substring(3, 5) : numPart.substring(2, 4), 10)
  const seconds = parseInt(isLongitude ? numPart.substring(5, 7) : numPart.substring(4, 6), 10)

  if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) {
    throw new Error(`坐标包含非数字: ${coordinate}`)
  }

  const decimal = degrees + minutes / 60 + seconds / 3600
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal
}

function deriveLevel(maxLength: number, maxWidth: number): AirportLevel {
  if (maxLength >= 3600 && maxWidth >= 60) return '4F'
  if (maxLength >= 3000) return '4E'
  if (maxLength >= 2500) return '4D'
  if (maxLength >= 1800) return '4C'
  return '3C'
}

function loadRunwayRows() {
  const path = dataFile('RWY.csv')
  if (!existsSync(path)) return []
  return records(path).filter((row) => row.CODE_AIRPORT)
}

export function loadRunwayLevels(): Map<string, AirportLevel> {
  const levels = new Map<string, AirportLevel>()
  const maxLength = new Map<string, number>()
  const maxWidth = new Map<string, number>()

  for (const row of loadRunwayRows()) {
    const code = row.CODE_AIRPORT.toUpperCase()
    const length = Number(row.VAL_LEN)
    const width = Number(row.VAL_WID)
    if (Number.isFinite(length)) {
      maxLength.set(code, Math.max(maxLength.get(code) ?? 0, length))
    }
    if (Number.isFinite(width)) {
      maxWidth.set(code, Math.max(maxWidth.get(code) ?? 0, width))
    }
  }

  for (const code of new Set([...maxLength.keys(), ...maxWidth.keys()])) {
    levels.set(code, deriveLevel(maxLength.get(code) ?? 0, maxWidth.get(code) ?? 0))
  }
  return levels
}

export function loadRunwayInfo(): Map<string, RunwayInfo[]> {
  const info = new Map<string, RunwayInfo[]>()
  const directions = new Map<string, number>()
  const directionPath = dataFile('RWY_DIRECTION.csv')

  if (existsSync(directionPath)) {
    for (const row of records(directionPath)) {
      const bearing = Number(row.VAL_TRUE_BRG)
      if (row.RWY_ID && Number.isFinite(bearing)) {
        directions.set(row.RWY_ID, bearing)
      }
    }
  }

  for (const row of loadRunwayRows()) {
    const code = row.CODE_AIRPORT.toUpperCase()
    const list = info.get(code) ?? []
    list.push({
      designator: row.TXT_DESIG || '',
      length: Number(row.VAL_LEN) || 0,
      width: Number(row.VAL_WID) || 0,
      bearing: directions.get(row.RWY_ID),
    })
    info.set(code, list)
  }
  return info
}

export interface LoadAirportsOptions {
  onWarn?: (message: string) => void
}

export function loadAirports(options: LoadAirportsOptions = {}): Airport[] {
  const path = dataFile('AD_HP.csv')
  if (!existsSync(path)) {
    throw new Error(`机场数据库不存在: ${path}`)
  }

  const levels = loadRunwayLevels()
  const airports = new Map<string, Airport>()

  for (const row of records(path)) {
    const icao = (row.CODE_ID || '').toUpperCase()
    if (!/^[A-Z0-9]{4}$/.test(icao)) continue
    if (airports.has(icao)) continue

    const rawLat = row.GEO_LAT_ACCURACY
    const rawLon = row.GEO_LONG_ACCURACY
    if (!rawLat || !rawLon) continue

    try {
      airports.set(icao, {
        icao,
        name: row.TXT_NAME || '未知机场',
        iata: (row.CODE_IATA || '').toUpperCase(),
        lat: parseCoordinate(rawLat),
        lon: parseCoordinate(rawLon),
        level: levels.get(icao) ?? '4C',
      })
    } catch (error) {
      options.onWarn?.(`${icao} 坐标解析失败: ${error instanceof Error ? error.message : error}`)
    }
  }

  return [...airports.values()]
}

export function loadInternationalAirports(): Airport[] {
  const path = dataFile('Airports.json')
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, any>>

  return rows
    .map((row) => {
      const icao = row.ICAO?.toString().trim().toUpperCase()
      const lat = Number(row.Latitude)
      const lon = Number(row.Longitude)
      if (!icao || icao.length !== 4 || /\d/.test(icao)) return null
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

      return {
        icao,
        name: row.Name?.toString().trim() || icao,
        iata: row.PrimaryID?.toString().trim().toUpperCase() || '',
        lat,
        lon,
      } satisfies Airport
    })
    .filter(Boolean) as Airport[]
}
