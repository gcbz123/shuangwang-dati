// generate-icons.js
// 运行一次生成 PNG 图标：node generate-icons.js
// 需要 Node.js >= 18，无需额外依赖（使用内置 Canvas API 的 Polyfill 方案）
// 如果没有 canvas 包，可以手动替换 icons/ 里的 PNG 文件

const fs = require('fs');
const path = require('path');

// 生成简单的 SVG 图标并保存
function generateSVGIcon(size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#60a5fa"/>
      <stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#g)"/>
  <text x="${size/2}" y="${size * 0.72}" font-size="${size * 0.55}" text-anchor="middle" fill="white">🎓</text>
</svg>`;
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

[16, 48, 128].forEach(size => {
    const svgPath = path.join(iconsDir, `icon${size}.svg`);
    fs.writeFileSync(svgPath, generateSVGIcon(size), 'utf-8');
    console.log(`生成 icon${size}.svg`);
});

console.log('\n图标已生成为 SVG 格式（icons/ 目录）');
console.log('Chrome 插件需要 PNG 格式。转换方法：');
console.log('  方法1: 用 Inkscape 批量导出 PNG');
console.log('  方法2: 用 ImageMagick: convert icon48.svg icon48.png');
console.log('  方法3: 在线工具 https://svgtopng.com 上传转换');
console.log('\n或者直接修改 manifest.json 使用 SVG（部分 Chrome 版本支持）');
