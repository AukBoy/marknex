// PDF helpers used at upload time.
//
// Why this exists: the AI grades from what it can SEE. When a PDF is sent to the
// backend, only its extracted text is forwarded to the model, so any (x, y)
// mistake coordinates it returns are guesses with no spatial basis — markers
// land in the wrong place. By rasterizing the PDF to an image in the browser
// before upload, the model sees the real page layout (accurate coordinates) and
// the frontend can overlay markers pixel-exactly (images render at their natural
// aspect ratio, unlike a fixed-height PDF iframe).

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const isPdf = (file) =>
    !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

/**
 * Render a PDF File into a single tall PNG File (all pages stacked vertically).
 * @param {File} file  The PDF file selected by the user.
 * @param {object} [opts]
 * @param {number} [opts.scale=2]  Render scale — higher = sharper but larger.
 * @returns {Promise<File>} A PNG File ready to upload.
 */
export async function rasterizePdfToImage(file, { scale = 2 } = {}) {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const pages = [];
    let totalHeight = 0;
    let maxWidth = 0;

    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.push(canvas);
        totalHeight += canvas.height;
        maxWidth = Math.max(maxWidth, canvas.width);
    }

    // Combine every page into one image so a single (x, y) grid covers the whole script.
    const out = document.createElement('canvas');
    out.width = maxWidth;
    out.height = totalHeight;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);

    let y = 0;
    for (const c of pages) {
        ctx.drawImage(c, 0, y);
        y += c.height;
    }

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    const name = (file.name || 'document').replace(/\.pdf$/i, '') + '.png';
    return new File([blob], name, { type: 'image/png' });
}

/**
 * If the file is a single-page PDF, convert it to an image for accurate (x, y)
 * coordinate overlay; otherwise return it unchanged.
 *
 * Multi-page PDFs (e.g. CamScanner scans with several pages) are left as PDF
 * so the backend can convert each page to a separate high-res image and send
 * them individually to the AI. Stacking many pages into one tall PNG made the
 * image too large and caused the AI to misread handwritten content.
 */
export async function toImageIfPdf(file) {
    if (!isPdf(file)) return file;
    try {
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (pdf.numPages > 1) {
            // Multi-page: let the backend handle per-page conversion
            return file;
        }
        return await rasterizePdfToImage(file);
    } catch (err) {
        console.error('PDF rasterization failed, uploading original PDF:', err);
        return file;
    }
}
