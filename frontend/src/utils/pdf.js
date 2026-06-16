// PDF helpers used at upload time.
//
// Multi-page PDFs (CamScanner scans) are split into individual page images so
// each page reaches GPT-4o at full resolution. Combining pages into one tall
// JPEG degrades handwriting legibility — the model reads each page separately.

import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export const isPdf = (file) =>
    !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

/**
 * Render a single PDF page into a high-res JPEG.
 */
async function renderPage(pdf, pageNum, scale, baseName) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
    const suffix = pdf.numPages > 1 ? `_page${pageNum}` : '';
    const name = baseName + suffix + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
}

/**
 * Convert a PDF to an array of high-res JPEG images (one per page).
 * Single-page PDFs return a one-element array.
 * Returns the original file (in an array) if it's not a PDF.
 */
export async function toImagesIfPdf(file) {
    if (!isPdf(file)) return [file];
    try {
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const baseName = (file.name || 'document').replace(/\.pdf$/i, '');
        const scale = 2.5;
        const pages = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            pages.push(await renderPage(pdf, p, scale, baseName));
        }
        console.log(`[PDF] Rendered ${pages.length} page(s) at scale ${scale}`);
        return pages;
    } catch (err) {
        console.error('PDF rasterization failed, uploading original PDF:', err);
        return [file];
    }
}

/**
 * Legacy single-file wrapper: returns the first page image for contexts
 * that only accept one file (marking scheme upload, MCQ key upload).
 * For multi-page PDFs, combines pages into one tall image.
 */
export async function toImageIfPdf(file) {
    if (!isPdf(file)) return file;
    try {
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const baseName = (file.name || 'document').replace(/\.pdf$/i, '');

        if (pdf.numPages === 1) {
            return await renderPage(pdf, 1, 2.5, baseName);
        }

        // For single-file contexts (marking scheme, MCQ key), combine pages
        // into one tall image at high scale
        const scale = 2;
        const canvases = [];
        let totalHeight = 0, maxWidth = 0;
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            canvases.push(canvas);
            totalHeight += canvas.height;
            maxWidth = Math.max(maxWidth, canvas.width);
        }

        const out = document.createElement('canvas');
        out.width = maxWidth;
        out.height = totalHeight;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        let y = 0;
        for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }

        const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.95));
        return new File([blob], baseName + '.jpg', { type: 'image/jpeg' });
    } catch (err) {
        console.error('PDF rasterization failed, uploading original PDF:', err);
        return file;
    }
}
