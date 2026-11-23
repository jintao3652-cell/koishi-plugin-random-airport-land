import axios from 'axios'
import { Logger } from 'koishi'

const logger = new Logger('route-search')
const BASE = 'https://api.xflysim.com/pilot/api'
const MAP = `${BASE}/realTimeMap`
const TIMEOUT = 10000

type Procedure = [string, string, unknown?]

export interface RouteWaypoint {
  name: string
  lat: number
  lon: number
}

export interface RouteResult {
  ok: boolean
  route: string
  waypoints: RouteWaypoint[]
  distanceNm?: number
  cycle?: string
  text: string[]
}

function json<T>(value: unknown): T | null {
  if (typeof value === 'object' && value !== null) return value as T
  try { return JSON.parse(String(value)) as T } catch { return null }
}

async function getMetar(icao: string): Promise<string> {
  try {
    const res = await axios.get(`${BASE}/efb/weather/metar/${icao}`, { timeout: TIMEOUT })
    if (res.data?.code === 20000) return res.data.data?.rawText || res.data.data?.metar || '暂无 METAR'
  } catch (error) {
    logger.debug(`EFB METAR 不可用 ${icao}: ${axios.isAxiosError(error) ? error.response?.status : error}`)
  }
  try {
    const res = await axios.get(`${MAP}/weather/${icao}`, { timeout: TIMEOUT })
    return res.data?.data?.rawText || res.data?.data?.metar || '暂无 METAR'
  } catch {
    logger.warn(`${icao} 无可用 METAR，继续查询航路`)
    return '暂无 METAR'
  }
}

async function getRunways(icao: string): Promise<any[]> {
  try {
    const res = await axios.get(`${BASE}/efb/runway/${icao}`, { timeout: TIMEOUT })
    return res.data?.code === 20000 && Array.isArray(res.data.data) ? res.data.data : []
  } catch { return [] }
}

function wind(raw: string) {
  const m = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?(KT|MPS)\b/)
  return m ? { direction: m[1] === 'VRB' ? null : Number(m[1]), speed: Number(m[2]) * (m[3] === 'MPS' ? 1.94384 : 1) } : null
}

type RunwayWind = { ident: string; heading: number; head: number; cross: number }
function recommendedRunways(runways: any[], raw: string): RunwayWind[] {
  const w = wind(raw)
  if (!w || w.direction === null) return []
  const ends = runways.flatMap(r => [
    { ident: r.leIdent, heading: Number(r.leHeadingDegt) },
    { ident: r.heIdent, heading: Number(r.heHeadingDegt) },
  ]).filter(x => x.ident && Number.isFinite(x.heading)).map(x => {
    const angle = ((w.direction! - x.heading + 540) % 360) - 180
    return { ...x, head: Math.cos(angle * Math.PI / 180) * w.speed, cross: Math.abs(Math.sin(angle * Math.PI / 180) * w.speed) }
  }).filter(x => x.head > 0).sort((a, b) => b.head - a.head)
  return ends
}

function procedures(source: any, point: string): Procedure[] {
  const list = source?.[point]
  return Array.isArray(list) ? list : []
}

function formatRunways(items: RunwayWind[]): string {
  return items.length ? items.map(x => `${x.ident}（逆风 ${x.head.toFixed(1)} kt，侧风 ${x.cross.toFixed(1)} kt）`).join('、') : '无逆风跑道或无法根据风况推荐'
}

function formatProcedure(list: Procedure[], point: string, runways: RunwayWind[], kind: '离场' | '进场'): string {
  const runwaySet = new Set(runways.map(x => x.ident))
  const matching = list
  if (!matching.length) return `\n依据当前风向推荐：\n无\n\n该${kind}点所有可用程序：\n无`
  const preferred = runways.length
    ? matching.filter(p => runwaySet.has(p[1]) || p[1] === 'ALL')
    : []
  const render = (p: Procedure) => `${p[0]}(跑道 ${p[1] === 'ALL' ? '全部' : p[1]})`
  const unavailable = runways.length ? '无匹配当前逆风跑道的程序' : '无法根据当前风况确定推荐跑道，因此不推荐程序'
  return `\n依据当前风向推荐：\n${preferred.length ? preferred.map(render).join('、') : unavailable}\n\n该${kind}点所有可用程序：\n${matching.map(render).join('、')}`
}

function toNumber(value: unknown): number | undefined {
  const num = Number(value)
  return Number.isFinite(num) && num !== 0 ? num : undefined
}

function resolveFix(fix: unknown): RouteWaypoint | null {
  if (Array.isArray(fix)) {
    const name = String(fix[0] ?? '').trim()
    const lat = toNumber(fix[1])
    const lon = toNumber(fix[2])
    return name && lat !== undefined && lon !== undefined ? { name, lat, lon } : null
  }
  if (fix && typeof fix === 'object') {
    const item = fix as Record<string, unknown>
    const name = String(item.name ?? item.ident ?? item.id ?? '').trim()
    const lat = toNumber(item.lat ?? item.latitude ?? item.latitudeDeg)
    const lon = toNumber(item.lon ?? item.lng ?? item.longitude ?? item.longitudeDeg)
    return name && lat !== undefined && lon !== undefined ? { name, lat, lon } : null
  }
  return null
}

function waypointsFromNodes(nodes: unknown): RouteWaypoint[] {
  if (!Array.isArray(nodes)) return []
  const result: RouteWaypoint[] = []
  for (const node of nodes) {
    const fix = resolveFix(node)
    if (fix) result.push(fix)
  }
  return result
}

async function parseRoutePoints(route: string, dep: string, arr: string, cycle: string): Promise<RouteWaypoint[]> {
  try {
    const res = await axios.post(`${BASE}/efb/parseRoute`, null, {
      params: { route, dep, arr, cycle },
      timeout: TIMEOUT,
    })
    if (res.data?.code !== 20000) return []
    const data = json<any>(res.data?.data)
    if (!data) return []
    return waypointsFromNodes(data.waypoints)
  } catch (error) {
    logger.debug(`parseRoute 不可用: ${axios.isAxiosError(error) ? error.response?.status : error}`)
    return []
  }
}

export async function getRoute(dep: string, arr: string): Promise<RouteResult> {
  dep = dep.toUpperCase(); arr = arr.toUpperCase()
  try {
    const cycleRes = await axios.get(`${BASE}/efb/getRouteCycle`, { timeout: TIMEOUT })
    const cycles = json<Array<string | number>>(cycleRes.data?.data) || []
    const cycle = Math.max(...cycles.map(Number).filter(Number.isFinite))
    if (!Number.isFinite(cycle)) {
      return { ok: false, route: '', waypoints: [], text: ['无法获取导航数据周期'] }
    }

    const [depMetar, arrMetar, depRunways, arrRunways] = await Promise.all([
      getMetar(dep), getMetar(arr), getRunways(dep), getRunways(arr),
    ])
    const res = await axios.post(`${BASE}/efb/route`, null, { params: { dep, arr, cycle }, timeout: TIMEOUT })
    const data = json<any>(res.data?.data)
    if (res.data?.code !== 20000 || !data || data.error) {
      return { ok: false, route: '', waypoints: [], text: ['获取航路失败'] }
    }

    const routeText = String(data.route || '').trim()
    const tokens = routeText.split(/\s+/)
    const sidMarker = tokens.indexOf('SID')
    const starMarker = tokens.lastIndexOf('STAR')
    const sidPoint = sidMarker >= 0 ? tokens[sidMarker + 1] || '' : tokens[1] || ''
    const starPoint = starMarker > 0 ? tokens[starMarker - 1] || '' : tokens.at(-2) || ''
    const depRunway = recommendedRunways(depRunways, depMetar)
    const arrRunway = recommendedRunways(arrRunways, arrMetar)

    // 地图坐标首选 parseRoute（文档给出 lat/lon），失败时回落 route 接口的 nodeinformation
    let waypoints = routeText ? await parseRoutePoints(routeText, dep, arr, String(cycle)) : []
    if (!waypoints.length) waypoints = waypointsFromNodes(data.nodeinformation)

    const distanceNm = toNumber(data.distance) ?? toNumber(data.distance_nm)
    const usedCycle = data.data_version || String(cycle)

    const text = [
      `完整航路: ${data.route || '无'}`,
      `飞行距离: ${distanceNm ?? '未知'} 海里`,
      `导航数据周期: ${usedCycle}`,
      `起飞机场 METAR: ${depMetar}`,
      `降落机场 METAR: ${arrMetar}`,
      `推荐起飞跑道: ${formatRunways(depRunway)}`,
      `SID: ${formatProcedure(procedures(data.SID, sidPoint), sidPoint, depRunway, '离场')}`,
      `推荐降落跑道: ${formatRunways(arrRunway)}`,
      `STAR: ${formatProcedure(procedures(data.STAR, starPoint), starPoint, arrRunway, '进场')}`,
    ]

    return {
      ok: true,
      route: routeText,
      waypoints,
      distanceNm,
      cycle: String(usedCycle),
      text,
    }
  } catch (error) {
    logger.error(`获取航路失败: ${error instanceof Error ? error.message : error}`)
    return { ok: false, route: '', waypoints: [], text: ['获取航路失败，请稍后再试'] }
  }
}
