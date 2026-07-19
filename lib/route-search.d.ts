/**
 * 获取航路信息
 * @param dep 起飞机场 ICAO 代码
 * @param arr 降落机场 ICAO 代码
 * @returns 返回航路信息的字符串数组
 */
export declare function getRoute(dep: string, arr: string): Promise<string[]>;
