// Annotates a raw screenshot PNG (base64) with visual references that help
// the vision model reason about pixel coordinates and iterate on clicks:
//
//   1. A subtle grid overlay every GRID_SPACING pixels, with coordinate
//      labels at every second intersection. Gives the model absolute
//      spatial reference points regardless of what's on screen.
//
//   2. A bright crosshair at the LAST CLICK location (if provided), with a
//      text label showing the exact (x, y). When the agent's click missed
//      its target, this is the only way the model can adjust the next
//      attempt: "my click landed here, the real gear icon is 25px to the
//      right and 10px up, so next time try (x+25, y-10)".
//
// Grid spacing is in absolute pixels — resolution-independent. On a 1366×768
// screen you get ~14×8 cells; on 1920×1080 you get ~19×11; the density
// stays consistent. The image's native dimensions are read from the PNG
// itself so the overlay always matches, even if the logical screen size
// reported by the OS (via getScreenSize) differs due to HiDPI scaling.

import sharp from 'sharp';

const GRID_SPACING = 100;   // pixels between grid lines
const GRID_COLOR   = 'rgba(0,255,120,0.20)';   // faint green, visible on both light & dark
const LABEL_COLOR  = 'rgba(0,255,120,0.75)';
const MARK_COLOR   = '#ff2d2d';                 // high-contrast red for the click marker
const MARK_SHADOW  = 'rgba(0,0,0,0.9)';

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&apos;', '"':'&quot;' }[c]));
}

function buildOverlaySvg(width, height, { grid, lastClick }) {
  let out = '';

  if (grid) {
    // Vertical grid lines
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      out += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${GRID_COLOR}" stroke-width="1"/>`;
      // Label at top, every other line, to avoid clutter
      if (x % (GRID_SPACING * 2) === 0) {
        out += `<text x="${x + 2}" y="11" font-family="monospace" font-size="10" font-weight="bold"
                 fill="${LABEL_COLOR}" paint-order="stroke" stroke="${MARK_SHADOW}" stroke-width="2">${x}</text>`;
      }
    }
    // Horizontal grid lines
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      out += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${GRID_COLOR}" stroke-width="1"/>`;
      if (y % (GRID_SPACING * 2) === 0) {
        out += `<text x="2" y="${y - 2}" font-family="monospace" font-size="10" font-weight="bold"
                 fill="${LABEL_COLOR}" paint-order="stroke" stroke="${MARK_SHADOW}" stroke-width="2">${y}</text>`;
      }
    }
  }

  if (lastClick && Number.isFinite(lastClick.x) && Number.isFinite(lastClick.y)) {
    const { x, y } = lastClick;
    const labelText = `last click (${x},${y})`;
    // Crosshair: outer circle, centre dot, cardinal ticks
    out += `
      <circle cx="${x}" cy="${y}" r="14" fill="none" stroke="${MARK_COLOR}" stroke-width="2.5"/>
      <circle cx="${x}" cy="${y}" r="2.5" fill="${MARK_COLOR}"/>
      <line x1="${x - 20}" y1="${y}" x2="${x - 6}" y2="${y}" stroke="${MARK_COLOR}" stroke-width="2.5"/>
      <line x1="${x + 6}" y1="${y}" x2="${x + 20}" y2="${y}" stroke="${MARK_COLOR}" stroke-width="2.5"/>
      <line x1="${x}" y1="${y - 20}" x2="${x}" y2="${y - 6}" stroke="${MARK_COLOR}" stroke-width="2.5"/>
      <line x1="${x}" y1="${y + 6}" x2="${x}" y2="${y + 20}" stroke="${MARK_COLOR}" stroke-width="2.5"/>
    `;
    // Label positioned to the right, but flip to left if near right edge
    const labelW = labelText.length * 7 + 8;
    const labelX = (x + 22 + labelW > width) ? (x - 22 - labelW) : (x + 22);
    const labelY = Math.max(16, Math.min(y - 14, height - 4));
    out += `
      <rect x="${labelX}" y="${labelY - 12}" width="${labelW}" height="16" fill="${MARK_SHADOW}" rx="2"/>
      <text x="${labelX + 4}" y="${labelY + 1}" font-family="monospace" font-size="11" font-weight="bold"
            fill="white">${escapeXml(labelText)}</text>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${out}</svg>`;
}

/**
 * @param {string} pngBase64 - base64-encoded PNG of the original screenshot
 * @param {object} [opts]
 * @param {boolean} [opts.grid=true] - draw the coordinate grid
 * @param {{x:number,y:number}|null} [opts.lastClick] - draw crosshair at this point
 * @returns {Promise<string>} base64 PNG with the overlay composited on top
 */
export async function annotateScreenshot(pngBase64, opts = {}) {
  const { grid = true, lastClick = null } = opts;
  if (!grid && !lastClick) return pngBase64;   // nothing to draw — return original

  const srcBuf = Buffer.from(pngBase64, 'base64');
  const meta = await sharp(srcBuf).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return pngBase64;

  const svg = buildOverlaySvg(width, height, { grid, lastClick });
  const out = await sharp(srcBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return out.toString('base64');
}
