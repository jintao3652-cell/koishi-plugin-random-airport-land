import axios from 'axios';
import { Logger } from 'koishi';

const logger = new Logger('route-search');
const API_BASE_URL = 'https://api.xflysim.com/pilot/api/realTimeMap';
const REQUEST_TIMEOUT = 5000;

// 定义接口类型
interface RouteData {
  route: string;
  distance: number;
  data_version: string;
  nodeinformation: any[];
  SID: Record<string, [string, string][]>;
  STAR: Record<string, [string, string][]>;
  error?: string;
}

interface MetarData {
  metar: string;
  code: number;
  message: string;
}

/**
 * 获取 METAR 数据
 * @param airport 机场 ICAO 代码
 * @returns 返回 METAR 数据
 */
async function fetchMetarData(airport: string): Promise<MetarData> {
  logger.info(`开始获取机场 ${airport} 的 METAR 数据`);
  try {
    const response = await axios.get(`${API_BASE_URL}/weather/${airport}`, {
      timeout: REQUEST_TIMEOUT,
    });
    logger.info(`API 响应成功，状态码: ${response.status}`);
    if (response.data.code !== 20000) {
      logger.warn(`API 返回错误信息: ${response.data.message}`);
      throw new Error(response.data.message || '无法获取 METAR 数据');
    }
    logger.info('成功获取 METAR 数据');
    return {
      metar: response.data.data.metar,
      code: response.data.code,
      message: response.data.message,
    };
  } catch (error) {
    logger.error(`获取 METAR 数据失败: ${error instanceof Error ? error.message : error}`);
    return {
      metar: '无法获取 METAR 数据，请稍后再试。',
      code: 500,
      message: '请求失败',
    };
  }
}

/**
 * 获取航路信息
 * @param dep 起飞机场 ICAO 代码
 * @param arr 降落机场 ICAO 代码
 * @returns 返回航路信息的字符串数组
 */
export async function getRoute(dep: string, arr: string): Promise<string[]> {
  if (!isValidICAO(dep) || !isValidICAO(arr)) {
    logger.warn(`无效的 ICAO 代码: dep=${dep}, arr=${arr}`);
    return ["无效的 ICAO 代码", "", ""];
  }
  try {
    // 获取最新的数据周期
    const cycleResponse = await axios.get(`${API_BASE_URL}/getRouteCycle`, {
      timeout: REQUEST_TIMEOUT,
    });
    logger.debug('获取数据周期的原始响应:', cycleResponse.data);
    const cycleList = parseJSON<number[]>(cycleResponse.data.data);
    if (!cycleList || !Array.isArray(cycleList)) {
      logger.warn('cycleList 数据无效');
      return ["cycleList 数据无效", "", ""];
    }
    const maxCycle = Math.max(...cycleList.map(Number));
    if (!isFinite(maxCycle)) {
      logger.warn('无法获取有效的 cycle');
      return ["无法获取有效的 cycle", "", ""];
    }
    logger.debug(`使用的数据周期: ${maxCycle}`);

    // 获取 METAR 数据
    const metar1Responce = await fetchMetarData(dep);
    const metar1 = metar1Responce.metar;
    const metar1code = metar1Responce.code;
    if (metar1code == 500) {
      logger.warn('metar 数据无效(dep)');
      return ["metar 数据无效(dep)", "", ""];
    }
    const metar2Responce = await fetchMetarData(arr);
    const metar2 = metar2Responce.metar;
    const metar2code = metar2Responce.code;
    if (metar2code == 500) {
      logger.warn('metar 数据无效(arr)');
      return ["metar 数据无效(arr)", "", ""];
    }

    // 获取航路数据
    const routeResponse = await axios.post(`${API_BASE_URL}/route`, null, {
      params: { dep, arr, cycle: maxCycle },
      timeout: REQUEST_TIMEOUT,
    });
    logger.debug('获取航路数据的原始响应:', routeResponse.data);
    const routeAllData = parseJSON<RouteData>(routeResponse.data.data);
    if (!routeAllData) {
      logger.warn('routeAllData 数据无效');
      return ["routeAllData 数据无效", "", ""];
    }
    if (routeAllData.error) {
      logger.warn(`无效的起飞机场/降落机场: ${dep}/${arr}`);
      return ["无效的起飞机场/降落机场", "", ""];
    }

    const { route, distance, data_version, nodeinformation, SID, STAR } = routeAllData;
    const slicedRoute = route.trim().split(/\s+/);
    if (slicedRoute.length < 2) {
      logger.warn('航路数据不完整');
      return ["航路数据不完整", "", ""];
    }
    const [departureAirport, arrivalAirport] = [slicedRoute[0], slicedRoute[slicedRoute.length - 1]];
    const sidPoint = slicedRoute[2];
    const starPoint = slicedRoute[slicedRoute.length - 3];
    const avalSid = SID[sidPoint] || [];
    const avalStar = STAR[starPoint] || [];

    const sections = [
      { title: "航路概览", content: `从 ${departureAirport} 到 ${arrivalAirport} 的航路:` },
      { title: "完整航路", content: `完整航路: ${route}` },
      { title: "飞行距离", content: `飞行距离: ${distance || '未知'} 海里` },
      { title: "数据周期", content: `数据周期: ${data_version || '未知'}` },
      { title: "起飞机场METAR", content: `起飞机场METAR: ${metar1}` },
      { title: "着陆机场METAR", content: `着陆机场METAR: ${metar2}` },
      { title: "总航路点数量", content: `总航路点数量: ${nodeinformation ? nodeinformation.length - 2 : '未知'}` },
      { title: `${departureAirport} 的所有可用 SID 程序（不按风向）`, content: formatTransitions(avalSid) },
      { title: `${arrivalAirport} 的可用 STAR 程序（不按风向）`, content: formatTransitions(avalStar) },
    ];
    return sections.map(section => `${section.title}: ${section.content}`);
  } catch (error) {
    logger.error(`获取航路信息时出错: ${error}`);
    return ["获取航路信息时出错", "", ""];
  }
}

/**
 * 格式化 SID/STAR 过渡信息
 * @param transitions 过渡信息数组
 * @returns 格式化后的字符串
 */
function formatTransitions(transitions: [string, string][]): string {
  if (!Array.isArray(transitions)) {
    return '无效的过渡数据';
  }
  const sortedTransitions = transitions.sort((a, b) => {
    const aValue = a[1];
    const bValue = b[1];
    if (aValue === "ALL") return -1;
    if (bValue === "ALL") return 1;
    return aValue.localeCompare(bValue);
  });
  const formatted = sortedTransitions.slice(0, 30).map(([procedure, availability]) =>
    `程序: ${procedure}, 可用性: ${availability === 'ALL' ? '所有跑道' : availability}`
  ).join('\n');
  return transitions.length > 35 ? `${formatted}\n······` : formatted;
}

/**
 * 解析 JSON 字符串
 * @param data 需要解析的 JSON 字符串
 * @returns 解析后的对象，如果解析失败则返回 null
 */
function parseJSON<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch (error) {
    logger.error('解析 JSON 数据时出错:', error);
    return null;
  }
}

/**
 * 验证 ICAO 代码
 * @param code ICAO 代码
 * @returns 是否为有效的 ICAO 代码
 */
function isValidICAO(code: string): boolean {
  return /^[A-Z]{4}$/.test(code);
}