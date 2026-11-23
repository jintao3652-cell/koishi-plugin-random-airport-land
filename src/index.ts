import { Context, Logger, Schema, h } from 'koishi';
import {} from '@shangxueink/koishi-plugin-puppeteer-without-canvas';
import { Airport, loadAirports as loadAirportDatabase, loadInternationalAirports as loadInternationalDatabase } from './airport-data';
import { RouteResult, getRoute } from './route-search';
import { renderRouteMap } from './map-image';
import { textToImage } from './txt-image';

export const inject = ['puppeteer', 'canvas'];

export interface Config {
  mapboxAccessToken: string;
}

export const Config: Schema<Config> = Schema.object({
  mapboxAccessToken: Schema.string().role('secret').default('').description('Mapbox access token（留空则只生成文字图片）'),
});

// 机场级别（与 airport-data 的 AirportLevel 保持一致，保留 Object.values 用法）
const AirportLevel = {
  ThreeC: '3C',
  FourC: '4C',
  FourD: '4D',
  FourE: '4E',
  FourF: '4F',
} as const

type AirportLevel = typeof AirportLevel[keyof typeof AirportLevel]

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStack(error: unknown): string {
  return error instanceof Error && error.stack ? error.stack : String(error);
}

const randomAirportsland = (ctx: Context, config: Config) => {
  const logger = new Logger('random-airports-land');
  let airports: Airport[] = [];
  let internationalAirports: Airport[] = [];
  const airportLevels = new Map<AirportLevel, Airport[]>();

  // 加载机场数据（AD_HP.csv + RWY.csv 推导等级）
  function loadAirports(): Airport[] {
    try {
      logger.info('开始加载机场数据（AD_HP.csv）...');
      const loadedAirports = loadAirportDatabase({ onWarn: (message) => logger.warn(message) });
      logger.info(`机场数据加载完成: 成功 ${loadedAirports.length}`);
      return loadedAirports;
    } catch (error) {
      logger.error('机场数据加载失败:');
      logger.error(getErrorStack(error));
      throw new Error(`机场数据初始化失败: ${getErrorMessage(error)}`);
    }
  }

  function loadInternationalAirports(): Airport[] {
    try {
      const loadedAirports = loadInternationalDatabase();
      logger.info(`国际机场数据加载完成: ${loadedAirports.length}`);
      return loadedAirports;
    } catch (error) {
      logger.error('国际机场数据加载失败:');
      logger.error(getErrorStack(error));
      throw new Error(`国际机场数据初始化失败: ${getErrorMessage(error)}`);
    }
  }

  // 刷新缓存
  function refreshCache() {
    logger.info('开始刷新机场缓存...');
    airportLevels.clear();
    
    Object.values(AirportLevel).forEach(level => {
      const airportsOfLevel = airports.filter(a => a.level === level);
      airportLevels.set(level, airportsOfLevel);
      logger.debug(`级别 ${level}: ${airportsOfLevel.length} 个机场`);
    });
    
    logger.info('机场缓存已刷新');
  }

  async function renderOutput(output: string) {
    try {
      const imageBuffer = await textToImage(ctx, output);
      return h.image(imageBuffer, 'image/png');
    } catch (error) {
      logger.warn(`结果图片生成失败，回退为文本: ${getErrorMessage(error)}`);
      return output;
    }
  }

  async function renderMission(
    dep: Airport,
    arr: Airport,
    distance: number,
    route: RouteResult,
    outputLines: string[],
  ) {
    if (config.mapboxAccessToken) {
      try {
        const image = await renderRouteMap(ctx, {
          dep: { icao: dep.icao, name: dep.name, lat: dep.lat, lon: dep.lon },
          arr: { icao: arr.icao, name: arr.name, lat: arr.lat, lon: arr.lon },
          waypoints: route.waypoints,
          routeText: route.route,
          distanceNm: route.distanceNm ?? distance,
          cycle: route.cycle,
          token: config.mapboxAccessToken,
          title: '飞行任务航路图',
        })
        if (image) return h.image(image, 'image/png');
      } catch (error) {
        logger.warn(`航路地图生成失败，回退文字图: ${getErrorMessage(error)}`);
      }
    }
    return await renderOutput(outputLines.join('\n'));
  }

  // 计算大圆距离（精确版）
  function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 3440.065; // 地球半径（海里）
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(1)); // 保留1位小数
  }

  // 机场匹配函数（增强版）
  function findAirport(input: string): Airport {
    if (!input) throw new Error('请输入机场信息');
    
    const cleanInput = input.trim().toUpperCase();
    let matched: Airport[] = [];
    
    logger.debug(`开始搜索机场: ${cleanInput}`);
    
    // 精确匹配（ICAO/IATA）
    matched = airports.filter(a => 
      a.icao === cleanInput || 
      a.iata === cleanInput
    );
    
    // 名称模糊匹配（支持中文）
    if (!matched.length) {
      logger.debug('尝试模糊匹配...');
      matched = airports.filter(a => 
        a.name.toUpperCase().includes(cleanInput) ||
        a.name.includes(input) // 中文匹配
      );
    }
    
    // 处理匹配结果
    if (matched.length === 0) {
      throw new Error(`找不到匹配的机场: ${input}`);
    }
    
    logger.info(`找到 ${matched.length} 个匹配机场: ${matched.map(m => m.icao).join(', ')}`);
    return matched[0]; // 返回第一个匹配
  }

  function findInternationalAirport(input: string): Airport {
    if (!input) throw new Error('请输入机场信息');

    const cleanInput = input.trim().toUpperCase();
    let matched = internationalAirports.filter(a =>
      a.icao === cleanInput ||
      a.iata === cleanInput
    );

    if (!matched.length) {
      matched = internationalAirports.filter(a =>
        a.name.toUpperCase().includes(cleanInput) ||
        a.name.includes(input)
      );
    }

    if (matched.length === 0) {
      throw new Error(`找不到匹配的国际机场: ${input}`);
    }

    logger.info(`找到 ${matched.length} 个国际机场匹配: ${matched.map(m => m.icao).join(', ')}`);
    return matched[0];
  }

  // 获取指定级别的机场列表
  function getAirportsByLevel(level: AirportLevel | 'DEFAULT'): Airport[] {
    if (level === 'DEFAULT') {
      // 默认级别：4D, 4E, 4F
      return [
        ...(airportLevels.get(AirportLevel.FourD) || []),
        ...(airportLevels.get(AirportLevel.FourE) || []),
        ...(airportLevels.get(AirportLevel.FourF) || [])
      ];
    }
    return airportLevels.get(level) || [];
  }

  // 主命令实现 - 支持三种形式
  ctx.command('/随机落地 [arg1] [arg2]', '随机生成飞行任务（固定落地机场）')
    .usage('输入格式：/随机落地 [落地机场] [距离(海里)]')
    .example('/随机落地 ZGGG  固定广州白云机场落地')
    .example('/随机落地 ZGGG 600  固定广州落地且起飞机场距离在600海里内')
    .example('/随机落地 600  固定起落机场距离在600海里内')
    .action(async ({ session }, arg1, arg2) => {
      try {
        logger.info(`收到随机落地指令: ${arg1 || ''} ${arg2 || ''}`);
        
        // 确保机场数据已加载
        if (!airports.length) {
          airports = loadAirports();
          refreshCache();
        }
        
        // 解析参数
        let arrivalInput: string | null = null;
        let maxDistance: number | null = null;
        
        // 解析距离参数（支持"600"或"600海里"格式）
        const parseDistance = (str: string): number | null => {
          const match = str.match(/^(\d+)(海里)?$/);
          return match ? parseInt(match[1]) : null;
        };
        
        // 参数处理逻辑
        if (arg1) {
          const distanceVal = parseDistance(arg1);
          if (distanceVal !== null) {
            maxDistance = distanceVal;
            logger.info(`设置距离限制: ${maxDistance} 海里`);
          } else {
            arrivalInput = arg1;
            logger.info(`设置落地机场: ${arrivalInput}`);
          }
        }
        
        if (arg2) {
          const distanceVal = parseDistance(arg2);
          if (distanceVal !== null) {
            maxDistance = distanceVal;
            logger.info(`设置距离限制: ${maxDistance} 海里`);
          } else if (!arrivalInput) {
            // 如果第一个参数不是距离，第二个参数也不是距离，则视为机场
            arrivalInput = arg2;
            logger.info(`设置落地机场: ${arrivalInput}`);
          }
        }

        // 获取符合条件的机场列表（4E/4F级别）
        const allValidAirports = getAirportsByLevel('DEFAULT');
        logger.info(`可用机场总数: ${allValidAirports.length}`);
        
        // 确定落地机场和起飞机场
        let arr: Airport | null = null;
        let dep: Airport | null = null;
        
        // 情况1：指定了落地机场
        if (arrivalInput) {
          const arrivalAirport = findAirport(arrivalInput);
          arr = arrivalAirport;
          logger.info(`确定落地机场: ${arrivalAirport.name} (${arrivalAirport.icao})`);
          
          // 获取符合条件的起飞机场（排除落地机场）
          let validAirports = allValidAirports.filter(a => a.icao !== arrivalAirport.icao);
          logger.info(`可用起飞机场数: ${validAirports.length}`);
          
          // 应用距离限制
          if (maxDistance !== null) {
            validAirports = validAirports.filter(depCandidate => {
              const distance = haversine(depCandidate.lat, depCandidate.lon, arrivalAirport.lat, arrivalAirport.lon);
              return distance <= maxDistance;
            });
            logger.info(`距离限制后可用起飞机场数: ${validAirports.length}`);
            
            // 如果距离限制后没有可用机场
            if (validAirports.length === 0) {
              throw new Error(`在${maxDistance}海里内没有找到符合条件的起飞机场`);
            }
          }
          
          // 随机选择起飞机场
          const depIndex = Math.floor(Math.random() * validAirports.length);
          dep = validAirports[depIndex];
          logger.info(`随机选择起飞机场: ${dep.name} (${dep.icao})`);
        } 
        // 情况2：未指定落地机场，但指定了距离限制
        else if (maxDistance !== null) {
          // 随机选择一对机场（距离在限制内）
          let found = false;
          let attempts = 0;
          const maxAttempts = 50; // 最大尝试次数
          
          logger.info(`开始寻找距离在${maxDistance}海里内的机场对...`);
          
          while (!found && attempts < maxAttempts) {
            // 随机选择起飞机场
            const depIndex = Math.floor(Math.random() * allValidAirports.length);
            const departureAirport = allValidAirports[depIndex];
            dep = departureAirport;
            
            // 获取符合条件的落地机场（排除起飞机场）
            let validAirports = allValidAirports.filter(a => a.icao !== departureAirport.icao);
            
            // 过滤出距离在限制内的机场
            validAirports = validAirports.filter(arrCandidate => {
              const distance = haversine(departureAirport.lat, departureAirport.lon, arrCandidate.lat, arrCandidate.lon);
              return distance <= maxDistance;
            });
            
            // 如果找到合适的机场，选择其中一个作为落地机场
            if (validAirports.length > 0) {
              const arrIndex = Math.floor(Math.random() * validAirports.length);
              arr = validAirports[arrIndex];
              found = true;
              logger.info(`找到机场对: ${departureAirport.icao} -> ${arr.icao} (距离: ${haversine(departureAirport.lat, departureAirport.lon, arr.lat, arr.lon)}海里)`);
            }
            
            attempts++;
          }
          
          if (!found) {
            throw new Error(`在${maxDistance}海里内没有找到符合条件的机场对`);
          }
        } 
        // 情况3：完全随机
        else {
          // 随机选择起飞机场
          const depIndex = Math.floor(Math.random() * allValidAirports.length);
          const departureAirport = allValidAirports[depIndex];
          dep = departureAirport;
          
          // 获取符合条件的落地机场（排除起飞机场）
          let validAirports = allValidAirports.filter(a => a.icao !== departureAirport.icao);
          
          // 随机选择落地机场
          const arrIndex = Math.floor(Math.random() * validAirports.length);
          arr = validAirports[arrIndex];
          logger.info(`随机选择机场对: ${departureAirport.icao} -> ${arr.icao}`);
        }

        // 计算实际距离
        if (!dep || !arr) {
          throw new Error('未能生成有效的起降机场组合');
        }

        const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
        logger.info(`计算距离: ${distance}海里`);
        
        // 获取航路
        logger.info(`获取航路: ${dep.icao} -> ${arr.icao}`);
        const route = await getRoute(dep.icao, arr.icao);
        logger.info(`航路点数量: ${route.waypoints.length}`);

        // 格式化输出
        const outputLines = [
          '✈️ 飞行任务生成成功',
          `🛫 起飞机场：${dep.name} (${dep.icao}${dep.iata ? '/' + dep.iata : ''}) [${dep.level}]`,
          `🛬 落地机场：${arr.name} (${arr.icao}${arr.iata ? '/' + arr.iata : ''}) [${arr.level}]`,
          `📏 飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
          ...(maxDistance ? [`🔒 距离限制：≤ ${maxDistance} 海里`] : []),
          '🛣️ 推荐航路：',
          ...(route.text.length > 0
            ? route.text.map((point, i) => `${i + 1}. ${point.replace(/\n/g, '<br>')}`)
            : ['⚠️ 无标准航路信息，建议自行规划']
          ),
        ];

        logger.info('生成结果输出...');
        return await renderMission(dep, arr, distance, route, outputLines);
      } catch (err) {
        logger.error(`指令执行失败：${getErrorMessage(err)}`);
        return [
          '❌ 任务生成失败',
          `错误信息：${getErrorMessage(err)}`,
          '💡 请检查：',
          '1. 机场代码是否正确（如ZGGG/CAN)',
          '2. 机场名称是否完整（如"北京首都"）',
          '3. 距离限制是否合理（中国境内建议100-1200海里）',
          '4. 目标机场是否符合级别要求'
        ].join('\n');
      }
    });

  ctx.command('/随机国际落地 [arg1] [arg2]', '随机生成国际飞行任务（固定落地机场）')
    .usage('输入格式：/随机国际落地 [落地机场] [距离(海里)]')
    .example('/随机国际落地 EGLL')
    .example('/随机国际落地 EGLL 600')
    .example('/随机国际落地 600')
    .action(async ({ session }, arg1, arg2) => {
      try {
        if (!internationalAirports.length) {
          internationalAirports = loadInternationalAirports();
        }

        let arrivalInput: string | null = null;
        let maxDistance: number | null = null;

        const parseDistance = (str: string): number | null => {
          const match = str.match(/^(\d+)(海里)?$/);
          return match ? parseInt(match[1]) : null;
        };

        if (arg1) {
          const distanceVal = parseDistance(arg1);
          if (distanceVal !== null) {
            maxDistance = distanceVal;
          } else {
            arrivalInput = arg1;
          }
        }

        if (arg2) {
          const distanceVal = parseDistance(arg2);
          if (distanceVal !== null) {
            maxDistance = distanceVal;
          } else if (!arrivalInput) {
            arrivalInput = arg2;
          }
        }

        const allValidAirports = internationalAirports;
        let arr: Airport | null = null;
        let dep: Airport | null = null;

        if (arrivalInput) {
          const arrivalAirport = findInternationalAirport(arrivalInput);
          arr = arrivalAirport;
          let validAirports = allValidAirports.filter(a => a.icao !== arrivalAirport.icao);

          if (maxDistance !== null) {
            validAirports = validAirports.filter(depCandidate => {
              const distance = haversine(depCandidate.lat, depCandidate.lon, arrivalAirport.lat, arrivalAirport.lon);
              return distance <= maxDistance;
            });

            if (validAirports.length === 0) {
              throw new Error(`在${maxDistance}海里内没有找到符合条件的起飞机场`);
            }
          }

          const depIndex = Math.floor(Math.random() * validAirports.length);
          dep = validAirports[depIndex];
        } else if (maxDistance !== null) {
          let found = false;
          let attempts = 0;
          const maxAttempts = 50;

          while (!found && attempts < maxAttempts) {
            const depIndex = Math.floor(Math.random() * allValidAirports.length);
            const departureAirport = allValidAirports[depIndex];
            dep = departureAirport;

            let validAirports = allValidAirports.filter(a => a.icao !== departureAirport.icao);
            validAirports = validAirports.filter(arrCandidate => {
              const distance = haversine(departureAirport.lat, departureAirport.lon, arrCandidate.lat, arrCandidate.lon);
              return distance <= maxDistance;
            });

            if (validAirports.length > 0) {
              const arrIndex = Math.floor(Math.random() * validAirports.length);
              arr = validAirports[arrIndex];
              found = true;
            }

            attempts++;
          }

          if (!found) {
            throw new Error(`在${maxDistance}海里内没有找到符合条件的机场对`);
          }
        } else {
          const depIndex = Math.floor(Math.random() * allValidAirports.length);
          const departureAirport = allValidAirports[depIndex];
          dep = departureAirport;

          const validAirports = allValidAirports.filter(a => a.icao !== departureAirport.icao);
          const arrIndex = Math.floor(Math.random() * validAirports.length);
          arr = validAirports[arrIndex];
        }

        if (!dep || !arr) {
          throw new Error('未能生成有效的国际起降机场组合');
        }

        const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
        const route = await getRoute(dep.icao, arr.icao);

        const outputLines = [
          '国际飞行任务生成成功',
          `起飞机场：${dep.name} (${dep.icao}${dep.iata ? '/' + dep.iata : ''})`,
          `落地机场：${arr.name} (${arr.icao}${arr.iata ? '/' + arr.iata : ''})`,
          `飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
          ...(maxDistance ? [`距离限制：≤ ${maxDistance} 海里`] : []),
          '推荐航路：',
          ...(route.text.length > 0
            ? route.text.map((point, i) => `${i + 1}. ${point.replace(/\n/g, '<br>')}`)
            : ['无标准航路信息，建议自行规划']
          ),
        ];

        return await renderMission(dep, arr, distance, route, outputLines);
      } catch (err) {
        logger.error(`随机国际落地指令执行失败：${getErrorMessage(err)}`);
        return [
          '国际任务生成失败',
          `错误信息：${getErrorMessage(err)}`,
          '请检查：',
          '1. 机场代码是否正确（如 EGLL/KLAX）',
          '2. 机场名称是否完整',
          '3. 距离限制是否合理',
        ].join('\n');
      }
    });

  // 新增指令：随机等级
  ctx.command('随机等级 <level1> [level2]', '根据机场级别随机生成飞行任务')
    .usage('输入格式：随机等级 <起飞机场级别> [落地机场级别]')
    .example('随机等级 4F       - 起飞机场为4F级，落地机场为4D/4E/4F随机')
    .example('随机等级 4E 4C    - 起飞机场为4E级，落地机场为4C级')
    .example('随机等级 4D       - 起飞机场为4D级，落地机场为4D/4E/4F随机')
    .action(async ({ session }, level1, level2) => {
      try {
        logger.info(`收到随机等级指令: 起飞=${level1}, 落地=${level2 || '默认'}`);
        
        // 确保机场数据已加载
        if (!airports.length) {
          airports = loadAirports();
          refreshCache();
        }
        
        // 验证级别参数
        const validateLevel = (lvl: string): AirportLevel => {
          const validLevels = Object.values(AirportLevel);
          if (!validLevels.includes(lvl as AirportLevel)) {
            throw new Error(`无效机场级别: ${lvl}。有效级别: ${validLevels.join(', ')}`);
          }
          return lvl as AirportLevel;
        };
        
        const depLevel = validateLevel(level1);
        const arrLevel = level2 ? validateLevel(level2) : 'DEFAULT';
        
        logger.info(`设置级别: 起飞=${depLevel}, 落地=${arrLevel === 'DEFAULT' ? '4D/4E/4F' : arrLevel}`);
        
        // 获取符合条件的机场列表
        const depAirports = getAirportsByLevel(depLevel);
        const arrAirports = getAirportsByLevel(arrLevel);
        
        logger.info(`可用起飞机场数: ${depAirports.length}`);
        logger.info(`可用落地机场数: ${arrAirports.length}`);
        
        if (depAirports.length === 0) {
          throw new Error(`没有找到 ${depLevel} 级别的起飞机场`);
        }
        if (arrAirports.length === 0) {
          throw new Error(`没有找到 ${arrLevel === 'DEFAULT' ? '4D/4E/4F' : arrLevel} 级别的落地机场`);
        }
        
        // 随机选择起飞机场
        const depIndex = Math.floor(Math.random() * depAirports.length);
        const dep = depAirports[depIndex];
        logger.info(`随机选择起飞机场: ${dep.name} (${dep.icao})`);
        
        // 随机选择落地机场（排除起飞机场）
        const validArrAirports = arrAirports.filter(a => a.icao !== dep.icao);
        if (validArrAirports.length === 0) {
          throw new Error(`没有找到可用的落地机场（排除起飞机场后）`);
        }
        
        const arrIndex = Math.floor(Math.random() * validArrAirports.length);
        const arr = validArrAirports[arrIndex];
        logger.info(`随机选择落地机场: ${arr.name} (${arr.icao})`);
        
        // 计算实际距离
        const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
        logger.info(`计算距离: ${distance}海里`);
        
        // 获取航路
        logger.info(`获取航路: ${dep.icao} -> ${arr.icao}`);
        const route = await getRoute(dep.icao, arr.icao);
        logger.info(`航路点数量: ${route.waypoints.length}`);

        // 格式化输出
        const outputLines = [
          '✈️ 飞行任务生成成功 (按级别随机)',
          `🛫 起飞机场：${dep.name} (${dep.icao}${dep.iata ? '/' + dep.iata : ''}) [${dep.level}]`,
          `🛬 落地机场：${arr.name} (${arr.icao}${arr.iata ? '/' + arr.iata : ''}) [${arr.level}]`,
          `📏 飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
          `🔤 级别设置：起飞=${depLevel}, 落地=${arrLevel === 'DEFAULT' ? '4D/4E/4F' : arrLevel}`,
          '🛣️ 推荐航路：',
          ...(route.text.length > 0
            ? route.text.map((point, i) => `${i + 1}. ${point.replace(/\n/g, '<br>')}`)
            : ['⚠️ 无标准航路信息，建议自行规划']
          ),
        ];

        logger.info('生成结果输出...');
        return await renderMission(dep, arr, distance, route, outputLines);
      } catch (err) {
        logger.error(`随机等级指令执行失败：${getErrorMessage(err)}`);
        return [
          '❌ 任务生成失败',
          `错误信息：${getErrorMessage(err)}`,
          '💡 请检查：',
          '1. 机场级别是否正确（有效级别: 4C, 4D, 4E, 4F, 3C）',
          '2. 机场级别是否拼写正确',
          '3. 是否存在该级别的机场'
        ].join('\n');
      }
    });

  // 初始化加载数据
  ctx.on('ready', async () => {
    try {
      logger.info('插件初始化开始...');
      airports = loadAirports();
      internationalAirports = loadInternationalAirports();
      refreshCache();
      logger.info(`机场数据就绪，国内 ${airports.length} 个，国际 ${internationalAirports.length} 个`);
      } catch (err) {
        logger.error('插件初始化失败', err);
      }
  });

  // 刷新缓存命令
  ctx.command('刷新机场缓存', '强制重新加载机场数据')
    .alias('/刷新机场')
    .action(async ({ session }) => {
      try {
        const prevCount = airports.length;
        airports = loadAirports();
        internationalAirports = loadInternationalAirports();
        refreshCache();
        logger.info(`机场缓存刷新完成: ${prevCount} -> ${airports.length}, 国际 ${internationalAirports.length}`);
        return '✅ 机场数据已刷新';
      } catch (err) {
        logger.error('缓存刷新失败:', err);
        return '❌ 刷新失败：' + getErrorMessage(err);
      }
    });
};

export default randomAirportsland;
