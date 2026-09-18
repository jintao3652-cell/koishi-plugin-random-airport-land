import { Context } from 'koishi';

interface TextImageSection {
  title: string
  content: string
}

// 航空主题色彩方案
const colorScheme = {
  primary: '#1a73e8',
  secondary: '#4285f4',
  background: '#f8f9fa',
  cardBg: '#ffffff',
  titleText: '#202124',
  bodyText: '#3c4043',
  accent: '#ea4335',
  border: '#dadce0'
};

// 美化后的HTML模板
const getHtmlTemplate = (
  sections: TextImageSection[],
  fontFamily = 'Segoe UI, Roboto, PingFang SC, Microsoft YaHei, sans-serif',
  fontSize = '18px',
  padding = '30px',
) => `
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
            align-items: flex-start;
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
            <div class="subtitle">Generated by Flight Planner • ${new Date().toLocaleDateString()}</div>
        </div>
        
        ${sections.map((section: TextImageSection) => `
        <div class="section">
            <div class="section-title">${section.title}</div>
            <div class="section-content">
                <pre>${formatContent(section.content)}</pre>
            </div>
        </div>`).join('\n')}
        
        <div class="footer">
            实际飞行请遵守管制员指令 • 飞行安全第一
        </div>
    </div>
</body>
</html>`;

// 内容格式化函数 - 移除了机场代码的高亮
function formatContent(content: string) {
  // 按行处理，避免重复替换
  return content.split('\n').map((line: string) => {
    // 处理机场信息行 - 加粗显示
    if (line.startsWith('起飞机场：') || line.startsWith('降落机场：')) {
      const parts = line.split('：');
      if (parts.length > 1) {
        const prefix = parts[0] + '：';
        const airportInfo = parts.slice(1).join('：');
        return `${prefix}<span class="airport-info">${airportInfo}</span>`;
      }
    }
    
    // 处理航路点行
    if (line.match(/^\d+\.\s/)) {
      const parts = line.split('. ');
      const num = parts[0];
      const text = parts.slice(1).join('. ');
      return `<div class="route-item"><div class="route-number">${num}</div><div class="route-text">${text}</div></div>`;
    }
    
    // 处理METAR信息
    if (line.includes('METAR：')) {
      const parts = line.split('：');
      if (parts.length > 1) {
        const prefix = parts[0] + '：';
        const metar = parts.slice(1).join('：');
        return `${prefix}<div class="metar-info">${metar}</div>`;
      }
    }
    
    // 处理程序列表
    if (line.startsWith('程序：')) {
      return `<div class="procedure-item">${line}</div>`;
    }
    
    // 处理其他行：高亮图标和关键信息（不再高亮机场代码）
    return line
      .replace(/✈️/g, '<span class="highlight">✈️</span>')
      .replace(/🛫/g, '<span class="highlight">🛫</span>')
      .replace(/🛬/g, '<span class="highlight">🛬</span>')
      .replace(/📏/g, '<span class="highlight">📏</span>')
      .replace(/🛣️/g, '<span class="highlight">🛣️</span>')
      .replace(/💡/g, '<span class="highlight">💡</span>')
      .replace(/🔒/g, '<span class="highlight">🔒</span>')
      .replace(/(\d+海里)/g, '<span class="highlight">$1</span>');
  }).join('\n');
}

async function textToImage(ctx: Context, input: string | TextImageSection[]) {
    const sections = typeof input === 'string'
        ? [{ title: '飞行计划详情', content: input }]
        : input;

    if (!Array.isArray(sections)) {
        throw new Error('Invalid input: sections must be an array or string');
    }

    for (const section of sections) {
        if (typeof section.title !== 'string' || typeof section.content !== 'string') {
            throw new Error('Invalid section format: each section must have a "title" and "content" property of type string');
        }
    }

    const page = await ctx.puppeteer.page();
    try {
        await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
        const content = getHtmlTemplate(sections);
        await page.setContent(content, { waitUntil: 'networkidle2', timeout: 30000 });
        const bodyHeight = await page.evaluate(() => Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
        ));
        await page.setViewport({ width: 800, height: bodyHeight, deviceScaleFactor: 2 });
        await page.evaluate(async () => {
            await document.fonts?.ready;
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        return await page.screenshot({ type: 'png', fullPage: true });
    } finally {
        await page.close();
    }
}

export { textToImage };
