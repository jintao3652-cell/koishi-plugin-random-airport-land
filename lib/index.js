var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);
var import_koishi2 = require("koishi");
var import_path = require("path");
var import_fs = require("fs");
var XLSX = __toESM(require("xlsx"));

// src/route-search.ts
var import_axios = __toESM(require("axios"));
var import_koishi = require("koishi");
var logger = new import_koishi.Logger("route-search");
var API_BASE_URL = "https://api.xflysim.com/pilot/api/realTimeMap";
var REQUEST_TIMEOUT = 5e3;
async function fetchMetarData(airport) {
  logger.info(`开始获取机场 ${airport} 的 METAR 数据`);
  try {
    const response = await import_axios.default.get(`${API_BASE_URL}/weather/${airport}`, {
      timeout: REQUEST_TIMEOUT
    });
    logger.info(`API 响应成功，状态码: ${response.status}`);
    if (response.data.code !== 2e4) {
      logger.warn(`API 返回错误信息: ${response.data.message}`);
      throw new Error(response.data.message || "无法获取 METAR 数据");
    }
    logger.info("成功获取 METAR 数据");
    return {
      metar: response.data.data.metar,
      code: response.data.code,
      message: response.data.message
    };
  } catch (error) {
    logger.error(`获取 METAR 数据失败: ${error instanceof Error ? error.message : error}`);
    return {
      metar: "无法获取 METAR 数据，请稍后再试。",
      code: 500,
      message: "请求失败"
    };
  }
}
__name(fetchMetarData, "fetchMetarData");
async function getRoute(dep, arr) {
  if (!isValidICAO(dep) || !isValidICAO(arr)) {
    logger.warn(`无效的 ICAO 代码: dep=${dep}, arr=${arr}`);
    return ["无效的 ICAO 代码", "", ""];
  }
  try {
    const cycleResponse = await import_axios.default.get(`${API_BASE_URL}/getRouteCycle`, {
      timeout: REQUEST_TIMEOUT
    });
    logger.debug("获取数据周期的原始响应:", cycleResponse.data);
    const cycleList = parseJSON(cycleResponse.data.data);
    if (!cycleList || !Array.isArray(cycleList)) {
      logger.warn("cycleList 数据无效");
      return ["cycleList 数据无效", "", ""];
    }
    const maxCycle = Math.max(...cycleList.map(Number));
    if (!isFinite(maxCycle)) {
      logger.warn("无法获取有效的 cycle");
      return ["无法获取有效的 cycle", "", ""];
    }
    logger.debug(`使用的数据周期: ${maxCycle}`);
    const metar1Responce = await fetchMetarData(dep);
    const metar1 = metar1Responce.metar;
    const metar1code = metar1Responce.code;
    if (metar1code == 500) {
      logger.warn("metar 数据无效(dep)");
      return ["metar 数据无效(dep)", "", ""];
    }
    const metar2Responce = await fetchMetarData(arr);
    const metar2 = metar2Responce.metar;
    const metar2code = metar2Responce.code;
    if (metar2code == 500) {
      logger.warn("metar 数据无效(arr)");
      return ["metar 数据无效(arr)", "", ""];
    }
    const routeResponse = await import_axios.default.post(`${API_BASE_URL}/route`, null, {
      params: { dep, arr, cycle: maxCycle },
      timeout: REQUEST_TIMEOUT
    });
    logger.debug("获取航路数据的原始响应:", routeResponse.data);
    const routeAllData = parseJSON(routeResponse.data.data);
    if (!routeAllData) {
      logger.warn("routeAllData 数据无效");
      return ["routeAllData 数据无效", "", ""];
    }
    if (routeAllData.error) {
      logger.warn(`无效的起飞机场/降落机场: ${dep}/${arr}`);
      return ["无效的起飞机场/降落机场", "", ""];
    }
    const { route, distance, data_version, nodeinformation, SID, STAR } = routeAllData;
    const slicedRoute = route.trim().split(/\s+/);
    if (slicedRoute.length < 2) {
      logger.warn("航路数据不完整");
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
      { title: "飞行距离", content: `飞行距离: ${distance || "未知"} 海里` },
      { title: "数据周期", content: `数据周期: ${data_version || "未知"}` },
      { title: "起飞机场METAR", content: `起飞机场METAR: ${metar1}` },
      { title: "着陆机场METAR", content: `着陆机场METAR: ${metar2}` },
      { title: "总航路点数量", content: `总航路点数量: ${nodeinformation ? nodeinformation.length - 2 : "未知"}` },
      { title: `${departureAirport} 的所有可用 SID 程序（不按风向）`, content: formatTransitions(avalSid) },
      { title: `${arrivalAirport} 的可用 STAR 程序（不按风向）`, content: formatTransitions(avalStar) }
    ];
    return sections.map((section) => `${section.title}: ${section.content}`);
  } catch (error) {
    logger.error(`获取航路信息时出错: ${error}`);
    return ["获取航路信息时出错", "", ""];
  }
}
__name(getRoute, "getRoute");
function formatTransitions(transitions) {
  if (!Array.isArray(transitions)) {
    return "无效的过渡数据";
  }
  const sortedTransitions = transitions.sort((a, b) => {
    const aValue = a[1];
    const bValue = b[1];
    if (aValue === "ALL") return -1;
    if (bValue === "ALL") return 1;
    return aValue.localeCompare(bValue);
  });
  const formatted = sortedTransitions.slice(0, 30).map(
    ([procedure, availability]) => `程序: ${procedure}, 可用性: ${availability === "ALL" ? "所有跑道" : availability}`
  ).join("\n");
  return transitions.length > 35 ? `${formatted}
······` : formatted;
}
__name(formatTransitions, "formatTransitions");
function parseJSON(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    logger.error("解析 JSON 数据时出错:", error);
    return null;
  }
}
__name(parseJSON, "parseJSON");
function isValidICAO(code) {
  return /^[A-Z]{4}$/.test(code);
}
__name(isValidICAO, "isValidICAO");

// src/txt-image.ts
var puppeteer = require("puppeteer");
var colorScheme = {
  primary: "#1a73e8",
  secondary: "#4285f4",
  background: "#f8f9fa",
  cardBg: "#ffffff",
  titleText: "#202124",
  bodyText: "#3c4043",
  accent: "#ea4335",
  border: "#dadce0"
};
var getHtmlTemplate = /* @__PURE__ */ __name((sections, fontFamily = "Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif", fontSize = "18px", padding = "30px") => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: ${fontFamily};
            background: linear-gradient(135deg, ${colorScheme.background} 0%, #e6f7ff 100%);
            color: ${colorScheme.bodyText};
            line-height: 1.6;
            padding: ${padding};
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .container {
            max-width: 800px;
            width: 100%;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px 0;
            border-bottom: 2px solid ${colorScheme.primary};
            position: relative;
        }
        
        .header:after {
            content: "✈️";
            position: absolute;
            right: 20px;
            top: 20px;
            font-size: 28px;
            opacity: 0.8;
        }
        
        .title {
            font-size: 32px;
            font-weight: 700;
            color: ${colorScheme.primary};
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 10px;
            letter-spacing: 1px;
        }
        
        .subtitle {
            font-size: 18px;
            color: ${colorScheme.bodyText};
            font-weight: 400;
            opacity: 0.9;
        }
        
        .section {
            background: ${colorScheme.cardBg};
            border-radius: 12px;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
            margin-bottom: 25px;
            overflow: hidden;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            border: 1px solid ${colorScheme.border};
        }
        
        .section:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
        }
        
        .section-title {
            background: linear-gradient(120deg, ${colorScheme.primary} 0%, ${colorScheme.secondary} 100%);
            color: white;
            font-size: 22px;
            font-weight: 600;
            padding: 16px 20px;
            display: flex;
            align-items: center;
        }
        
        .section-title:before {
            content: "📍";
            margin-right: 10px;
            font-size: 20px;
        }
        
        .section-content {
            padding: 25px;
            font-size: ${fontSize};
            line-height: 1.8;
        }
        
        .section-content pre {
            white-space: pre-wrap;
            word-break: break-word;
            font-family: inherit;
        }
        
        .highlight {
            color: ${colorScheme.accent};
            font-weight: 600;
        }
        
        .route-item {
            padding: 8px 0;
            border-bottom: 1px dashed ${colorScheme.border};
            display: flex;
            align-items: center;
        }
        
        .route-item:last-child {
            border-bottom: none;
        }
        
        .route-number {
            background: ${colorScheme.primary};
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 12px;
            flex-shrink: 0;
            font-size: 14px;
        }
        
        .route-text {
            flex: 1;
        }
        
        .airport-info {
            font-weight: 700;
            color: ${colorScheme.primary};
        }
        
        .metar-info {
            font-family: monospace;
            background-color: #f5f5f5;
            padding: 10px;
            border-radius: 4px;
            margin: 5px 0;
        }
        
        .procedure-list {
            margin-left: 20px;
        }
        
        .procedure-item {
            margin-bottom: 5px;
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid ${colorScheme.border};
            color: ${colorScheme.bodyText};
            font-size: 16px;
            opacity: 0.8;
            width: 100%;
        }
        
        .footer:before {
            content: "⚠️";
            margin-right: 8px;
        }
        
        @media (max-width: 600px) {
            body {
                padding: 15px;
            }
            
            .title {
                font-size: 26px;
            }
            
            .section-content {
                padding: 18px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="title">飞行任务计划</div>
            <div class="subtitle">Generated by Flight Planner • ${(/* @__PURE__ */ new Date()).toLocaleDateString()}</div>
        </div>
        
        ${sections.map((section) => `
        <div class="section">
            <div class="section-title">${section.title}</div>
            <div class="section-content">
                <pre>${formatContent(section.content)}</pre>
            </div>
        </div>`).join("\n")}
        
        <div class="footer">
            实际飞行请遵守管制员指令 • 飞行安全第一
        </div>
    </div>
</body>
</html>`, "getHtmlTemplate");
function formatContent(content) {
  return content.split("\n").map((line) => {
    if (line.startsWith("起飞机场：") || line.startsWith("降落机场：")) {
      const parts = line.split("：");
      if (parts.length > 1) {
        const prefix = parts[0] + "：";
        const airportInfo = parts.slice(1).join("：");
        return `${prefix}<span class="airport-info">${airportInfo}</span>`;
      }
    }
    if (line.match(/^\d+\.\s/)) {
      const parts = line.split(". ");
      const num = parts[0];
      const text = parts.slice(1).join(". ");
      return `<div class="route-item"><div class="route-number">${num}</div><div class="route-text">${text}</div></div>`;
    }
    if (line.includes("METAR：")) {
      const parts = line.split("：");
      if (parts.length > 1) {
        const prefix = parts[0] + "：";
        const metar = parts.slice(1).join("：");
        return `${prefix}<div class="metar-info">${metar}</div>`;
      }
    }
    if (line.startsWith("程序：")) {
      return `<div class="procedure-item">${line}</div>`;
    }
    return line.replace(/✈️/g, '<span class="highlight">✈️</span>').replace(/🛫/g, '<span class="highlight">🛫</span>').replace(/🛬/g, '<span class="highlight">🛬</span>').replace(/📏/g, '<span class="highlight">📏</span>').replace(/🛣️/g, '<span class="highlight">🛣️</span>').replace(/💡/g, '<span class="highlight">💡</span>').replace(/🔒/g, '<span class="highlight">🔒</span>').replace(/(\d+海里)/g, '<span class="highlight">$1</span>');
  }).join("\n");
}
__name(formatContent, "formatContent");
async function textToImage(input) {
  const sections = typeof input === "string" ? [{ title: "飞行计划详情", content: input }] : input;
  if (!Array.isArray(sections)) {
    throw new Error("Invalid input: sections must be an array or string");
  }
  for (const section of sections) {
    if (typeof section.title !== "string" || typeof section.content !== "string") {
      throw new Error('Invalid section format: each section must have a "title" and "content" property of type string');
    }
  }
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new"
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
  const content = getHtmlTemplate(sections);
  await page.setContent(content, { waitUntil: "networkidle2", timeout: 3e4 });
  const bodyHeight = await page.evaluate(() => {
    return Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.clientHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
  });
  await page.setViewport({
    width: 800,
    height: bodyHeight,
    deviceScaleFactor: 2
  });
  const imageBuffer = await page.screenshot({
    type: "png",
    fullPage: true
  });
  await browser.close();
  return imageBuffer;
}
__name(textToImage, "textToImage");
module.exports = { textToImage };

// src/index.ts
var AirportLevel = /* @__PURE__ */ ((AirportLevel2) => {
  AirportLevel2["FourC"] = "4C";
  AirportLevel2["FourD"] = "4D";
  AirportLevel2["FourE"] = "4E";
  AirportLevel2["FourF"] = "4F";
  AirportLevel2["ThreeC"] = "3C";
  return AirportLevel2;
})(AirportLevel || {});
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
__name(getErrorMessage, "getErrorMessage");
function getErrorStack(error) {
  return error instanceof Error && error.stack ? error.stack : String(error);
}
__name(getErrorStack, "getErrorStack");
var randomAirportsland = /* @__PURE__ */ __name((ctx) => {
  const logger2 = new import_koishi2.Logger("random-airports-land");
  let airports = [];
  let internationalAirports = [];
  const airportLevels = /* @__PURE__ */ new Map();
  function parseCoordinate(coordinate) {
    if (!coordinate || coordinate.length < 2) {
      throw new Error(`无效坐标格式: ${coordinate}`);
    }
    const hemisphere = coordinate[0];
    const numPart = coordinate.slice(1);
    const isLongitude = numPart.length === 7;
    let degrees, minutes, seconds;
    try {
      if (isLongitude) {
        degrees = parseInt(numPart.substring(0, 3));
        minutes = parseInt(numPart.substring(3, 5));
        seconds = parseInt(numPart.substring(5, 7));
      } else {
        degrees = parseInt(numPart.substring(0, 2));
        minutes = parseInt(numPart.substring(2, 4));
        seconds = parseInt(numPart.substring(4, 6));
      }
    } catch (e) {
      throw new Error(`坐标解析失败: ${coordinate} - ${getErrorMessage(e)}`);
    }
    if (isNaN(degrees) || isNaN(minutes) || isNaN(seconds)) {
      throw new Error(`坐标包含非数字: ${coordinate}`);
    }
    const decimal = degrees + minutes / 60 + seconds / 3600;
    return hemisphere === "S" || hemisphere === "W" ? -decimal : decimal;
  }
  __name(parseCoordinate, "parseCoordinate");
  function loadAirports() {
    try {
      logger2.info("开始加载机场数据...");
      const filePath = (0, import_path.resolve)(__dirname, "airports.xlsx");
      logger2.debug(`Excel文件路径: ${filePath}`);
      const workbook = XLSX.readFile(filePath);
      const sheetNames = workbook.SheetNames;
      logger2.debug(`工作表名称: ${sheetNames.join(", ")}`);
      const sheet = workbook.Sheets[sheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      if (!rows.length) {
        throw new Error("Excel文件为空或无数据");
      }
      logger2.info(`成功读取 ${rows.length} 行数据`);
      const loadedAirports = [];
      let successCount = 0;
      let errorCount = 0;
      for (const row of rows) {
        try {
          const icao = row.CODE_ID?.toString().trim();
          if (!icao) {
            logger2.warn("跳过无ICAO代码的行");
            continue;
          }
          const rawLat = row["GEO_LAT_ACCURACY"]?.toString().trim();
          const rawLon = row["GEO_LONG_ACCURACY"]?.toString().trim();
          if (!rawLat || !rawLon) {
            logger2.warn(`跳过 ${icao} - 缺少经纬度数据`);
            continue;
          }
          const rawLevel = row.level?.toString().trim().toUpperCase() || "4C";
          const level = Object.values(AirportLevel).includes(rawLevel) ? rawLevel : "4C" /* FourC */;
          const airport = {
            icao,
            name: row.TXT_NAME?.toString().trim() || "未知机场",
            iata: row.CODE_IATA?.toString().trim() || "",
            lat: parseCoordinate(rawLat),
            lon: parseCoordinate(rawLon),
            level
          };
          if (rawLevel !== level) {
            logger2.warn(`机场 ${icao} 有无效级别: ${rawLevel}`);
          }
          loadedAirports.push(airport);
          successCount++;
        } catch (e) {
          logger2.warn(`行数据解析失败: ${getErrorMessage(e)}`);
          errorCount++;
        }
      }
      logger2.info(`机场数据加载完成: 成功 ${successCount}, 失败 ${errorCount}`);
      return loadedAirports;
    } catch (error) {
      logger2.error("机场数据加载失败:");
      logger2.error(getErrorStack(error));
      throw new Error(`机场数据初始化失败: ${getErrorMessage(error)}`);
    }
  }
  __name(loadAirports, "loadAirports");
  function loadInternationalAirports() {
    try {
      const filePath = (0, import_path.resolve)(__dirname, "..", "Airports.json");
      const raw = (0, import_fs.readFileSync)(filePath, "utf8");
      const rows = JSON.parse(raw);
      const loadedAirports = rows.map((row) => {
        const icao = row.ICAO?.toString().trim().toUpperCase();
        const lat = Number(row.Latitude);
        const lon = Number(row.Longitude);
        if (!icao || icao.length !== 4 || /\d/.test(icao)) return null;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          icao,
          name: row.Name?.toString().trim() || icao,
          iata: row.PrimaryID?.toString().trim().toUpperCase() || "",
          lat,
          lon
        };
      }).filter(Boolean);
      logger2.info(`国际机场数据加载完成: ${loadedAirports.length}`);
      return loadedAirports;
    } catch (error) {
      logger2.error("国际机场数据加载失败:");
      logger2.error(getErrorStack(error));
      throw new Error(`国际机场数据初始化失败: ${getErrorMessage(error)}`);
    }
  }
  __name(loadInternationalAirports, "loadInternationalAirports");
  function refreshCache() {
    logger2.info("开始刷新机场缓存...");
    airportLevels.clear();
    Object.values(AirportLevel).forEach((level) => {
      const airportsOfLevel = airports.filter((a) => a.level === level);
      airportLevels.set(level, airportsOfLevel);
      logger2.debug(`级别 ${level}: ${airportsOfLevel.length} 个机场`);
    });
    logger2.info("机场缓存已刷新");
  }
  __name(refreshCache, "refreshCache");
  async function renderOutput(output) {
    try {
      const imageBuffer = await textToImage(output);
      return import_koishi2.h.image(imageBuffer, "image/png");
    } catch (error) {
      logger2.warn(`结果图片生成失败，回退为文本: ${getErrorMessage(error)}`);
      return output;
    }
  }
  __name(renderOutput, "renderOutput");
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 3440.065;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(1));
  }
  __name(haversine, "haversine");
  function findAirport(input) {
    if (!input) throw new Error("请输入机场信息");
    const cleanInput = input.trim().toUpperCase();
    let matched = [];
    logger2.debug(`开始搜索机场: ${cleanInput}`);
    matched = airports.filter(
      (a) => a.icao === cleanInput || a.iata === cleanInput
    );
    if (!matched.length) {
      logger2.debug("尝试模糊匹配...");
      matched = airports.filter(
        (a) => a.name.toUpperCase().includes(cleanInput) || a.name.includes(input)
        // 中文匹配
      );
    }
    if (matched.length === 0) {
      throw new Error(`找不到匹配的机场: ${input}`);
    }
    logger2.info(`找到 ${matched.length} 个匹配机场: ${matched.map((m) => m.icao).join(", ")}`);
    return matched[0];
  }
  __name(findAirport, "findAirport");
  function findInternationalAirport(input) {
    if (!input) throw new Error("请输入机场信息");
    const cleanInput = input.trim().toUpperCase();
    let matched = internationalAirports.filter(
      (a) => a.icao === cleanInput || a.iata === cleanInput
    );
    if (!matched.length) {
      matched = internationalAirports.filter(
        (a) => a.name.toUpperCase().includes(cleanInput) || a.name.includes(input)
      );
    }
    if (matched.length === 0) {
      throw new Error(`找不到匹配的国际机场: ${input}`);
    }
    logger2.info(`找到 ${matched.length} 个国际机场匹配: ${matched.map((m) => m.icao).join(", ")}`);
    return matched[0];
  }
  __name(findInternationalAirport, "findInternationalAirport");
  function getAirportsByLevel(level) {
    if (level === "DEFAULT") {
      return [
        ...airportLevels.get("4D" /* FourD */) || [],
        ...airportLevels.get("4E" /* FourE */) || [],
        ...airportLevels.get("4F" /* FourF */) || []
      ];
    }
    return airportLevels.get(level) || [];
  }
  __name(getAirportsByLevel, "getAirportsByLevel");
  ctx.command("/随机落地 [arg1] [arg2]", "随机生成飞行任务（固定落地机场）").usage("输入格式：/随机落地 [落地机场] [距离(海里)]").example("/随机落地 ZGGG  固定广州白云机场落地").example("/随机落地 ZGGG 600  固定广州落地且起飞机场距离在600海里内").example("/随机落地 600  固定起落机场距离在600海里内").action(async ({ session }, arg1, arg2) => {
    try {
      logger2.info(`收到随机落地指令: ${arg1 || ""} ${arg2 || ""}`);
      if (!airports.length) {
        airports = loadAirports();
        refreshCache();
      }
      let arrivalInput = null;
      let maxDistance = null;
      const parseDistance = /* @__PURE__ */ __name((str) => {
        const match = str.match(/^(\d+)(海里)?$/);
        return match ? parseInt(match[1]) : null;
      }, "parseDistance");
      if (arg1) {
        const distanceVal = parseDistance(arg1);
        if (distanceVal !== null) {
          maxDistance = distanceVal;
          logger2.info(`设置距离限制: ${maxDistance} 海里`);
        } else {
          arrivalInput = arg1;
          logger2.info(`设置落地机场: ${arrivalInput}`);
        }
      }
      if (arg2) {
        const distanceVal = parseDistance(arg2);
        if (distanceVal !== null) {
          maxDistance = distanceVal;
          logger2.info(`设置距离限制: ${maxDistance} 海里`);
        } else if (!arrivalInput) {
          arrivalInput = arg2;
          logger2.info(`设置落地机场: ${arrivalInput}`);
        }
      }
      const allValidAirports = getAirportsByLevel("DEFAULT");
      logger2.info(`可用机场总数: ${allValidAirports.length}`);
      let arr = null;
      let dep = null;
      if (arrivalInput) {
        const arrivalAirport = findAirport(arrivalInput);
        arr = arrivalAirport;
        logger2.info(`确定落地机场: ${arrivalAirport.name} (${arrivalAirport.icao})`);
        let validAirports = allValidAirports.filter((a) => a.icao !== arrivalAirport.icao);
        logger2.info(`可用起飞机场数: ${validAirports.length}`);
        if (maxDistance !== null) {
          validAirports = validAirports.filter((depCandidate) => {
            const distance2 = haversine(depCandidate.lat, depCandidate.lon, arrivalAirport.lat, arrivalAirport.lon);
            return distance2 <= maxDistance;
          });
          logger2.info(`距离限制后可用起飞机场数: ${validAirports.length}`);
          if (validAirports.length === 0) {
            throw new Error(`在${maxDistance}海里内没有找到符合条件的起飞机场`);
          }
        }
        const depIndex = Math.floor(Math.random() * validAirports.length);
        dep = validAirports[depIndex];
        logger2.info(`随机选择起飞机场: ${dep.name} (${dep.icao})`);
      } else if (maxDistance !== null) {
        let found = false;
        let attempts = 0;
        const maxAttempts = 50;
        logger2.info(`开始寻找距离在${maxDistance}海里内的机场对...`);
        while (!found && attempts < maxAttempts) {
          const depIndex = Math.floor(Math.random() * allValidAirports.length);
          const departureAirport = allValidAirports[depIndex];
          dep = departureAirport;
          let validAirports = allValidAirports.filter((a) => a.icao !== departureAirport.icao);
          validAirports = validAirports.filter((arrCandidate) => {
            const distance2 = haversine(departureAirport.lat, departureAirport.lon, arrCandidate.lat, arrCandidate.lon);
            return distance2 <= maxDistance;
          });
          if (validAirports.length > 0) {
            const arrIndex = Math.floor(Math.random() * validAirports.length);
            arr = validAirports[arrIndex];
            found = true;
            logger2.info(`找到机场对: ${departureAirport.icao} -> ${arr.icao} (距离: ${haversine(departureAirport.lat, departureAirport.lon, arr.lat, arr.lon)}海里)`);
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
        let validAirports = allValidAirports.filter((a) => a.icao !== departureAirport.icao);
        const arrIndex = Math.floor(Math.random() * validAirports.length);
        arr = validAirports[arrIndex];
        logger2.info(`随机选择机场对: ${departureAirport.icao} -> ${arr.icao}`);
      }
      if (!dep || !arr) {
        throw new Error("未能生成有效的起降机场组合");
      }
      const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
      logger2.info(`计算距离: ${distance}海里`);
      logger2.info(`获取航路: ${dep.icao} -> ${arr.icao}`);
      const route = await getRoute(dep.icao, arr.icao);
      logger2.info(`航路点数量: ${route.length}`);
      const outputLines = [
        "✈️ 飞行任务生成成功",
        `🛫 起飞机场：${dep.name} (${dep.icao}${dep.iata ? "/" + dep.iata : ""}) [${dep.level}]`,
        `🛬 落地机场：${arr.name} (${arr.icao}${arr.iata ? "/" + arr.iata : ""}) [${arr.level}]`,
        `📏 飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
        ...maxDistance ? [`🔒 距离限制：≤ ${maxDistance} 海里`] : [],
        "🛣️ 推荐航路：",
        ...route.length > 0 ? route.map((point, i) => `${i + 1}. ${point}`) : ["⚠️ 无标准航路信息，建议自行规划"]
      ];
      const output = outputLines.join("\n");
      logger2.info("生成结果输出...");
      return await renderOutput(output);
    } catch (err) {
      logger2.error(`指令执行失败：${getErrorMessage(err)}`);
      return [
        "❌ 任务生成失败",
        `错误信息：${getErrorMessage(err)}`,
        "💡 请检查：",
        "1. 机场代码是否正确（如ZGGG/CAN)",
        '2. 机场名称是否完整（如"北京首都"）',
        "3. 距离限制是否合理（中国境内建议100-1200海里）",
        "4. 目标机场是否符合级别要求"
      ].join("\n");
    }
  });
  ctx.command("/随机国际落地 [arg1] [arg2]", "随机生成国际飞行任务（固定落地机场）").usage("输入格式：/随机国际落地 [落地机场] [距离(海里)]").example("/随机国际落地 EGLL").example("/随机国际落地 EGLL 600").example("/随机国际落地 600").action(async ({ session }, arg1, arg2) => {
    try {
      if (!internationalAirports.length) {
        internationalAirports = loadInternationalAirports();
      }
      let arrivalInput = null;
      let maxDistance = null;
      const parseDistance = /* @__PURE__ */ __name((str) => {
        const match = str.match(/^(\d+)(海里)?$/);
        return match ? parseInt(match[1]) : null;
      }, "parseDistance");
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
      let arr = null;
      let dep = null;
      if (arrivalInput) {
        const arrivalAirport = findInternationalAirport(arrivalInput);
        arr = arrivalAirport;
        let validAirports = allValidAirports.filter((a) => a.icao !== arrivalAirport.icao);
        if (maxDistance !== null) {
          validAirports = validAirports.filter((depCandidate) => {
            const distance2 = haversine(depCandidate.lat, depCandidate.lon, arrivalAirport.lat, arrivalAirport.lon);
            return distance2 <= maxDistance;
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
          let validAirports = allValidAirports.filter((a) => a.icao !== departureAirport.icao);
          validAirports = validAirports.filter((arrCandidate) => {
            const distance2 = haversine(departureAirport.lat, departureAirport.lon, arrCandidate.lat, arrCandidate.lon);
            return distance2 <= maxDistance;
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
        const validAirports = allValidAirports.filter((a) => a.icao !== departureAirport.icao);
        const arrIndex = Math.floor(Math.random() * validAirports.length);
        arr = validAirports[arrIndex];
      }
      if (!dep || !arr) {
        throw new Error("未能生成有效的国际起降机场组合");
      }
      const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
      const route = await getRoute(dep.icao, arr.icao);
      const outputLines = [
        "国际飞行任务生成成功",
        `起飞机场：${dep.name} (${dep.icao}${dep.iata ? "/" + dep.iata : ""})`,
        `落地机场：${arr.name} (${arr.icao}${arr.iata ? "/" + arr.iata : ""})`,
        `飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
        ...maxDistance ? [`距离限制：≤ ${maxDistance} 海里`] : [],
        "推荐航路：",
        ...route.length > 0 ? route.map((point, i) => `${i + 1}. ${point}`) : ["无标准航路信息，建议自行规划"]
      ];
      return await renderOutput(outputLines.join("\n"));
    } catch (err) {
      logger2.error(`随机国际落地指令执行失败：${getErrorMessage(err)}`);
      return [
        "国际任务生成失败",
        `错误信息：${getErrorMessage(err)}`,
        "请检查：",
        "1. 机场代码是否正确（如 EGLL/KLAX）",
        "2. 机场名称是否完整",
        "3. 距离限制是否合理"
      ].join("\n");
    }
  });
  ctx.command("随机等级 <level1> [level2]", "根据机场级别随机生成飞行任务").usage("输入格式：随机等级 <起飞机场级别> [落地机场级别]").example("随机等级 4F       - 起飞机场为4F级，落地机场为4D/4E/4F随机").example("随机等级 4E 4C    - 起飞机场为4E级，落地机场为4C级").example("随机等级 4D       - 起飞机场为4D级，落地机场为4D/4E/4F随机").action(async ({ session }, level1, level2) => {
    try {
      logger2.info(`收到随机等级指令: 起飞=${level1}, 落地=${level2 || "默认"}`);
      if (!airports.length) {
        airports = loadAirports();
        refreshCache();
      }
      const validateLevel = /* @__PURE__ */ __name((lvl) => {
        const validLevels = Object.values(AirportLevel);
        if (!validLevels.includes(lvl)) {
          throw new Error(`无效机场级别: ${lvl}。有效级别: ${validLevels.join(", ")}`);
        }
        return lvl;
      }, "validateLevel");
      const depLevel = validateLevel(level1);
      const arrLevel = level2 ? validateLevel(level2) : "DEFAULT";
      logger2.info(`设置级别: 起飞=${depLevel}, 落地=${arrLevel === "DEFAULT" ? "4D/4E/4F" : arrLevel}`);
      const depAirports = getAirportsByLevel(depLevel);
      const arrAirports = getAirportsByLevel(arrLevel);
      logger2.info(`可用起飞机场数: ${depAirports.length}`);
      logger2.info(`可用落地机场数: ${arrAirports.length}`);
      if (depAirports.length === 0) {
        throw new Error(`没有找到 ${depLevel} 级别的起飞机场`);
      }
      if (arrAirports.length === 0) {
        throw new Error(`没有找到 ${arrLevel === "DEFAULT" ? "4D/4E/4F" : arrLevel} 级别的落地机场`);
      }
      const depIndex = Math.floor(Math.random() * depAirports.length);
      const dep = depAirports[depIndex];
      logger2.info(`随机选择起飞机场: ${dep.name} (${dep.icao})`);
      const validArrAirports = arrAirports.filter((a) => a.icao !== dep.icao);
      if (validArrAirports.length === 0) {
        throw new Error(`没有找到可用的落地机场（排除起飞机场后）`);
      }
      const arrIndex = Math.floor(Math.random() * validArrAirports.length);
      const arr = validArrAirports[arrIndex];
      logger2.info(`随机选择落地机场: ${arr.name} (${arr.icao})`);
      const distance = haversine(dep.lat, dep.lon, arr.lat, arr.lon);
      logger2.info(`计算距离: ${distance}海里`);
      logger2.info(`获取航路: ${dep.icao} -> ${arr.icao}`);
      const route = await getRoute(dep.icao, arr.icao);
      logger2.info(`航路点数量: ${route.length}`);
      const outputLines = [
        "✈️ 飞行任务生成成功 (按级别随机)",
        `🛫 起飞机场：${dep.name} (${dep.icao}${dep.iata ? "/" + dep.iata : ""}) [${dep.level}]`,
        `🛬 落地机场：${arr.name} (${arr.icao}${arr.iata ? "/" + arr.iata : ""}) [${arr.level}]`,
        `📏 飞行距离：${distance} 海里 (${(distance * 1.852).toFixed(1)} 公里)`,
        `🔤 级别设置：起飞=${depLevel}, 落地=${arrLevel === "DEFAULT" ? "4D/4E/4F" : arrLevel}`,
        "🛣️ 推荐航路：",
        ...route.length > 0 ? route.map((point, i) => `${i + 1}. ${point}`) : ["⚠️ 无标准航路信息，建议自行规划"]
      ];
      const output = outputLines.join("\n");
      logger2.info("生成结果输出...");
      return await renderOutput(output);
    } catch (err) {
      logger2.error(`随机等级指令执行失败：${getErrorMessage(err)}`);
      return [
        "❌ 任务生成失败",
        `错误信息：${getErrorMessage(err)}`,
        "💡 请检查：",
        "1. 机场级别是否正确（有效级别: 4C, 4D, 4E, 4F, 3C）",
        "2. 机场级别是否拼写正确",
        "3. 是否存在该级别的机场"
      ].join("\n");
    }
  });
  ctx.on("ready", async () => {
    try {
      logger2.info("插件初始化开始...");
      airports = loadAirports();
      internationalAirports = loadInternationalAirports();
      refreshCache();
      logger2.info(`机场数据就绪，国内 ${airports.length} 个，国际 ${internationalAirports.length} 个`);
    } catch (err) {
      logger2.error("插件初始化失败", err);
    }
  });
  ctx.command("刷新机场缓存", "强制重新加载机场数据").alias("/刷新机场").action(async ({ session }) => {
    try {
      const prevCount = airports.length;
      airports = loadAirports();
      internationalAirports = loadInternationalAirports();
      refreshCache();
      logger2.info(`机场缓存刷新完成: ${prevCount} -> ${airports.length}, 国际 ${internationalAirports.length}`);
      return "✅ 机场数据已刷新";
    } catch (err) {
      logger2.error("缓存刷新失败:", err);
      return "❌ 刷新失败：" + getErrorMessage(err);
    }
  });
}, "randomAirportsland");
var src_default = randomAirportsland;
