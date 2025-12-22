import {
  PDFDocument,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  translate,
  rotateRadians,
} from 'pdf-lib';

const PT_PER_MM = 72 / 25.4;

function mmToPt(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return 0;
  return n * PT_PER_MM;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const base64 = m[2];
  try {
    const bytes = Buffer.from(base64, 'base64');
    return { mime, bytes };
  } catch {
    return null;
  }
}

function pickStandardFont(fontFamily) {
  const f = String(fontFamily || '').toLowerCase();
  if (f.includes('times')) return StandardFonts.TimesRoman;
  if (f.includes('courier')) return StandardFonts.Courier;
  return StandardFonts.Helvetica;
}

function pushRotateAroundCenter(page, cx, cy, rotationDeg, w, h) {
  const rad = (Number(rotationDeg) || 0) * (Math.PI / 180);
  if (!rad) return false;
  page.pushOperators(
    pushGraphicsState(),
    translate(cx, cy),
    rotateRadians(rad),
    translate(-w / 2, -h / 2)
  );
  return true;
}

function popRotate(page) {
  page.pushOperators(popGraphicsState());
}

async function renderMmPage(pdfDoc, pageLayout) {
  const pageSpec = pageLayout?.page;
  const widthMm = Number(pageSpec?.widthMm);
  const heightMm = Number(pageSpec?.heightMm);
  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
    throw new Error('Missing or invalid page size (widthMm/heightMm)');
  }

  const pageWidthPt = mmToPt(widthMm);
  const pageHeightPt = mmToPt(heightMm);
  const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);

  const fontCache = new Map();
  const getFont = async (family) => {
    const key = pickStandardFont(family);
    if (fontCache.has(key)) return fontCache.get(key);
    const font = await pdfDoc.embedFont(key);
    fontCache.set(key, font);
    return font;
  };

  const items = Array.isArray(pageLayout?.items) ? pageLayout.items : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'image') {
      /**
       * IMAGE RENDERING RULE (LOCKED):
       * - Images are NEVER stretched by the system.
       * - If widthMm is provided and heightMm is not, height is derived from intrinsic aspect ratio.
       * - If heightMm is provided and widthMm is not, width is derived.
       * - If both are provided, the system assumes admin intent and does NOT correct.
       * - No container-based resizing is allowed.
       */
      const src = item.src;
      const parsed = parseDataUrl(src);
      if (!parsed) {
        throw new Error('image src must be a base64 data URL');
      }

      let drawWidthMm = Number(item.widthMm);
      let drawHeightMm = Number(item.heightMm);
      if (!Number.isFinite(drawWidthMm) || drawWidthMm <= 0) drawWidthMm = 0;
      if (!Number.isFinite(drawHeightMm) || drawHeightMm <= 0) drawHeightMm = 0;

      const aspectRatio = Number(item.aspectRatio);

      if (drawWidthMm && !drawHeightMm) {
        if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
          throw new Error('image item missing heightMm and aspectRatio');
        }
        drawHeightMm = drawWidthMm / aspectRatio;
      }

      if (!drawWidthMm && drawHeightMm) {
        if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
          throw new Error('image item missing widthMm and aspectRatio');
        }
        drawWidthMm = drawHeightMm * aspectRatio;
      }

      if (!drawWidthMm || !drawHeightMm) {
        throw new Error('image item must include widthMm or heightMm (and aspectRatio when one dimension is missing)');
      }

      const xPt = mmToPt(item.xMm);
      const yBottomPt = pageHeightPt - mmToPt(item.yMm) - mmToPt(drawHeightMm);
      const wPt = mmToPt(drawWidthMm);
      const hPt = mmToPt(drawHeightMm);

      if (wPt <= 0 || hPt <= 0) continue;

      let embedded;
      if (parsed.mime.includes('png')) {
        embedded = await pdfDoc.embedPng(parsed.bytes);
      } else if (parsed.mime.includes('jpeg') || parsed.mime.includes('jpg')) {
        embedded = await pdfDoc.embedJpg(parsed.bytes);
      } else {
        throw new Error(`Unsupported image mime type: ${parsed.mime}`);
      }

      const rotationDeg = Number(item.rotationDeg) || 0;
      if (rotationDeg) {
        const cx = xPt + wPt / 2;
        const cy = yBottomPt + hPt / 2;
        const pushed = pushRotateAroundCenter(page, cx, cy, rotationDeg, wPt, hPt);
        page.drawImage(embedded, { x: 0, y: 0, width: wPt, height: hPt });
        if (pushed) popRotate(page);
      } else {
        page.drawImage(embedded, { x: xPt, y: yBottomPt, width: wPt, height: hPt });
      }
      continue;
    }

    if (item.type === 'text') {
      const text = typeof item.text === 'string' ? item.text : '';
      if (!text) continue;

      const xPt = mmToPt(item.xMm);
      const yPt = pageHeightPt - mmToPt(item.yMm);
      const baseSizePt = mmToPt(item.fontSizeMm);
      if (baseSizePt <= 0) continue;

      // Treat yMm as a top-origin coordinate for text block. PDF uses bottom-origin,
      // and pdf-lib drawText y is the baseline. So we subtract font size.
      const baselineYpt = yPt - baseSizePt;

      const fontFamily = item.fontFamily;
      const font = await getFont(fontFamily);

      const rotationDeg = Number(item.rotationDeg) || 0;
      const letterFontSizesMm = Array.isArray(item.letterFontSizesMm) ? item.letterFontSizesMm : null;
      const offsetYmm = Array.isArray(item.offsetYmm) ? item.offsetYmm : null;
      const letterSpacingMm = Array.isArray(item.letterSpacingMm) ? item.letterSpacingMm : null;

      const drawLetters = () => {
        let cursorX = 0;
        const chars = Array.from(text);
        for (let i = 0; i < chars.length; i += 1) {
          const ch = chars[i];
          const sizePt = mmToPt(letterFontSizesMm?.[i] ?? item.fontSizeMm);
          // CSS positive Y is down; PDF positive Y is up. Keep contract: offsetYmm positive moves DOWN.
          const offsetYPt = -mmToPt(offsetYmm?.[i] ?? 0);
          const extraAfterPt = mmToPt(letterSpacingMm?.[i] ?? 0);

          if (sizePt > 0) {
            page.drawText(ch, {
              x: cursorX,
              y: offsetYPt,
              size: sizePt,
              font,
            });
            const adv = font.widthOfTextAtSize(ch, sizePt);
            cursorX += adv + extraAfterPt;
          }
        }
      };

      if (rotationDeg) {
        page.pushOperators(pushGraphicsState(), translate(xPt, baselineYpt), rotateRadians((rotationDeg * Math.PI) / 180));
        drawLetters();
        page.pushOperators(popGraphicsState());
      } else {
        page.pushOperators(pushGraphicsState(), translate(xPt, baselineYpt));
        drawLetters();
        page.pushOperators(popGraphicsState());
      }
      continue;
    }
  }
}

export async function generateOutputPdfBuffer(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('pages array is required');
  }

  const pdfDoc = await PDFDocument.create();
  for (const p of pages) {
    await renderMmPage(pdfDoc, p);
  }

  return Buffer.from(await pdfDoc.save());
}
