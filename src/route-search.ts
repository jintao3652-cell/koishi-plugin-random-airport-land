import axios from 'axios'
import { Logger } from 'koishi'

const logger = new Logger('route-search')
const BASE = 'https://api.xflysim.com/pilot/api'
const MAP = `${BASE}/realTimeMap`
const TIMEOUT = 10000

type Procedure = [string, string, unknown?]

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
  // list 已由 SID/STAR[point] 取得，数组中的 p[0] 是程序名而不是进离场点名。
  const matching = list
  if (!matching.length) return `\n依据当前风向推荐：\n无\n\n该${kind}点所有可用程序：\n无`
  // 没有成功算出逆风跑道时，不得把 ALL 程序误标为“依据风向推荐”。
  const preferred = runways.length
    ? matching.filter(p => runwaySet.has(p[1]) || p[1] === 'ALL')
    : []
  const render = (p: Procedure) => `${p[0]}(跑道 ${p[1] === 'ALL' ? '全部' : p[1]})`
  const unavailable = runways.length ? '无匹配当前逆风跑道的程序' : '无法根据当前风况确定推荐跑道，因此不推荐程序'
  return `\n依据当前风向推荐：\n${preferred.length ? preferred.map(render).join('、') : unavailable}\n\n该${kind}点所有可用程序：\n${matching.map(render).join('、')}`
}

export async function getRoute(dep: string, arr: string): Promise<string[]> {
  dep = dep.toUpperCase(); arr = arr.toUpperCase()
  try {
    const cycleRes = await axios.get(`${BASE}/efb/getRouteCycle`, { timeout: TIMEOUT })
    const cycles = json<Array<string | number>>(cycleRes.data?.data) || []
    const cycle = Math.max(...cycles.map(Number).filter(Number.isFinite))
    if (!Number.isFinite(cycle)) return ['无法获取导航数据周期']

    const [depMetar, arrMetar, depRunways, arrRunways] = await Promise.all([
      getMetar(dep), getMetar(arr), getRunways(dep), getRunways(arr),
    ])
    const res = await axios.post(`${BASE}/efb/route`, null, { params: { dep, arr, cycle }, timeout: TIMEOUT })
    const data = json<any>(res.data?.data)
    if (res.data?.code !== 20000 || !data || data.error) return ['获取航路失败']

    const tokens = String(data.route || '').trim().split(/\s+/)
    const sidMarker = tokens.indexOf('SID')
    const starMarker = tokens.lastIndexOf('STAR')
    const sidPoint = sidMarker >= 0 ? tokens[sidMarker + 1] || '' : tokens[1] || ''
    const starPoint = starMarker > 0 ? tokens[starMarker - 1] || '' : tokens.at(-2) || ''
    const depRunway = recommendedRunways(depRunways, depMetar)
    const arrRunway = recommendedRunways(arrRunways, arrMetar)
    return [
      `完整航路: ${data.route || '无'}`,
      `飞行距离: ${data.distance ?? '未知'} 海里`,
      `导航数据周期: ${data.data_version || cycle}`,
      `起飞机场 METAR: ${depMetar}`,
      `降落机场 METAR: ${arrMetar}`,
      `推荐起飞跑道: ${formatRunways(depRunway)}`,
      `SID: ${formatProcedure(procedures(data.SID, sidPoint), sidPoint, depRunway, '离场')}`,
      `推荐降落跑道: ${formatRunways(arrRunway)}`,
      `STAR: ${formatProcedure(procedures(data.STAR, starPoint), starPoint, arrRunway, '进场')}`,
    ]
  } catch (error) {
    logger.error(`获取航路失败: ${error instanceof Error ? error.message : error}`)
    return ['获取航路失败，请稍后再试']
  }
}
