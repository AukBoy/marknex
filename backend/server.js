require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Busboy = require('busboy');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./database');

const fs = require('fs');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const { fromPath } = require('pdf2pic');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ─── OCR HELPERS ──────────────────────────────────────────────────────────────

// Correct MIME type for every supported image format
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
        '.pdf':  'application/pdf',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png':  'image/png',
        '.webp': 'image/webp',
        '.bmp':  'image/bmp',
        '.gif':  'image/gif',
        '.tiff': 'image/tiff',
        '.tif':  'image/tiff',
    };
    return mimeMap[ext] || 'image/jpeg';
}

// Read a file and return its base64 string
function encodeImage(filePath) {
    return Buffer.from(fs.readFileSync(filePath)).toString('base64');
}

/**
 * Preprocess an image for better OCR quality using sharp:
 *   1. Convert to grayscale (reduces colour noise)
 *   2. Normalise contrast (auto-levels for dim scans)
 *   3. Sharpen (crisp edges improve character recognition)
 *   4. Increase contrast with a mild linear curve
 *   5. Output as high-quality JPEG (GPT-4o reads JPEG fastest)
 *
 * Returns the path to the preprocessed file (written next to the original).
 * Falls back to the original path if sharp fails (e.g., unsupported format).
 */
async function preprocessImageForOCR(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return filePath;

    const outPath = filePath.replace(/(\.[^.]+)$/, '_ocr_enhanced.jpg');
    try {
        const meta = await sharp(filePath).metadata();
        const width = meta.width || 0;

        let pipeline = sharp(filePath);

        // Upscale small images so digits are large enough for reliable reading.
        if (width > 0 && width < 2200) {
            pipeline = pipeline.resize({
                width: 2200,
                kernel: sharp.kernel.lanczos3,
                withoutEnlargement: false,
            });
        }

        pipeline = pipeline
            .grayscale()
            .normalize()
            .sharpen({ sigma: 1.5, m1: 1.5, m2: 3.0 })
            .linear(1.4, -30)
            .jpeg({ quality: 98 });

        await pipeline.toFile(outPath);
        return outPath;
    } catch (err) {
        console.warn(`[OCR] Image preprocessing failed for ${filePath}: ${err.message}. Using original.`);
        return filePath;
    }
}

/**
 * Split a tall combined image (e.g. CamScanner stitched pages) into
 * individual page-sized tiles so GPT-4o can read each page at full
 * resolution. Without this, the model hallucinates question content
 * from the tiny text in a single tall image.
 *
 * Returns null if the image doesn't need splitting.
 */
async function splitTallImage(filePath) {
    try {
        const meta = await sharp(filePath).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (!w || !h || h <= w * 1.8) return null;

        // Target tile height: roughly one printed page (A4 ≈ 1.41 × width).
        // Cap at 1600px so even non-standard pages get split fine.
        const tileH = Math.min(Math.round(w * 1.41), 1600);
        const numTiles = Math.ceil(h / tileH);
        if (numTiles <= 1) return null;

        const dir = path.dirname(filePath);
        const base = path.basename(filePath, path.extname(filePath));
        const tiles = [];

        for (let i = 0; i < numTiles; i++) {
            const top = i * tileH;
            const thisH = Math.min(tileH, h - top);
            if (thisH < 80) break;
            const tilePath = path.join(dir, `${base}_tile${i}.jpg`);
            await sharp(filePath)
                .extract({ left: 0, top, width: w, height: thisH })
                .jpeg({ quality: 95 })
                .toFile(tilePath);
            tiles.push(tilePath);
        }
        console.log(`[OCR] Split tall image (${w}×${h}) into ${tiles.length} tiles of ~${tileH}px each`);
        return tiles;
    } catch (err) {
        console.warn('[OCR] Tall-image split failed:', err.message);
        return null;
    }
}

async function pdfToImages(filePath) {
    const outDir = path.join(path.dirname(filePath), `pdf_pages_${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });

    try {
        const converter = fromPath(filePath, {
            density: 200,
            saveFilename: 'page',
            savePath: outDir,
            format: 'jpeg',
            width: 2048,
            height: 2048,
        });

        // Convert up to 10 pages (a 10-question math paper can span 5+ pages)
        const pageImages = [];
        for (let page = 1; page <= 10; page++) {
            try {
                const result = await converter(page);
                if (result && result.path && fs.existsSync(result.path)) {
                    const enhanced = await preprocessImageForOCR(result.path);
                    const base64 = encodeImage(enhanced);
                    pageImages.push({ base64, mimeType: 'image/jpeg' });
                    if (enhanced !== result.path) try { fs.unlinkSync(enhanced); } catch {}
                    try { fs.unlinkSync(result.path); } catch {}
                } else {
                    break;
                }
            } catch {
                break;
            }
        }

        try { fs.rmdirSync(outDir); } catch {}
        return pageImages;
    } catch (err) {
        try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
        throw new Error(`PDF → image conversion failed: ${err.message}`);
    }
}

/**
 * Build the GPT-4o content array for a file.
 *
 * For PDFs:
 *   • Attempt visual OCR (pdf2pic → preprocessed images) — works for
 *     handwritten scripts, scanned papers, etc.
 *   • If pdf2pic fails, fall back to embedded-text extraction via pdf-parse.
 *
 * For images:
 *   • Preprocess with sharp, then embed as a base64 image_url block.
 */
async function buildOCRContentArray(filePathOrPaths, promptText) {
    // Accept a single path or array of paths (multi-page uploads)
    const filePaths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    const contentArray = [{ type: 'text', text: promptText }];

    if (filePaths.length > 1) {
        contentArray.push({
            type: 'text',
            text: `This document has ${filePaths.length} page(s). Read ALL pages carefully before grading.`
        });
    }

    for (const filePath of filePaths) {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.pdf') {
            let usedVisualOCR = false;

            try {
                const pages = await pdfToImages(filePath);
                if (pages.length > 0) {
                    usedVisualOCR = true;
                    for (const { base64, mimeType } of pages) {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${mimeType};base64,${base64}`,
                                detail: 'high'
                            }
                        });
                    }
                    console.log(`[OCR] PDF visual OCR: ${pages.length} page(s) converted`);
                }
            } catch (err) {
                console.warn(`[OCR] Visual PDF OCR unavailable (${err.message}), falling back to text extraction`);
            }

            if (!usedVisualOCR) {
                try {
                    const dataBuffer = fs.readFileSync(filePath);
                    const data = await pdfParse(dataBuffer);
                    if (data.text && data.text.trim().length > 0) {
                        contentArray.push({ type: 'text', text: `Extracted text from PDF:\n\n${data.text}` });
                        console.log('[OCR] PDF text extraction fallback used');
                    } else {
                        contentArray.push({ type: 'text', text: 'WARNING: PDF has no extractable text (scanned image).' });
                    }
                } catch (pdfErr) {
                    console.error('[OCR] PDF text extraction also failed:', pdfErr.message);
                }
            }
        } else {
            // Tall combined images (CamScanner stitched pages) get split into
            // per-page tiles so GPT-4o reads each page at full resolution.
            const tiles = await splitTallImage(filePath);

            if (tiles && tiles.length > 1) {
                contentArray.push({
                    type: 'text',
                    text: `This image was split into ${tiles.length} page tiles. Each tile is one page of the answer paper — read EVERY tile from first to last. The printed question number and text are at the TOP of each tile.`
                });
            }

            const imagePaths = tiles || [filePath];
            for (const imgPath of imagePaths) {
                let processedPath = imgPath;
                try {
                    processedPath = await preprocessImageForOCR(imgPath);
                } catch (err) {
                    console.warn('[OCR] Preprocessing skipped:', err.message);
                }

                const mimeType = processedPath !== imgPath ? 'image/jpeg' : getMimeType(imgPath);
                const base64Image = encodeImage(processedPath);

                contentArray.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Image}`,
                        detail: 'high'
                    }
                });

                if (processedPath !== imgPath) {
                    try { fs.unlinkSync(processedPath); } catch {}
                }
            }

            // Clean up tile temp files
            if (tiles) {
                for (const t of tiles) { try { fs.unlinkSync(t); } catch {} }
            }

            console.log(`[OCR] Image encoded: ${imagePaths.length} segment(s) (${tiles ? 'split from tall image' : 'single'})`);
        }
    }

    return contentArray;
}

// ─── ENSEMBLE GRADING ─────────────────────────────────────────────────────────
// Run the AI grading model N times in parallel then average / merge the results.
// This mirrors the practice of "double marking" in education — multiple
// independent passes reduce variance from the model's stochastic behaviour and
// produce a fairer, more reproducible grade.
//
// Essay path:  runs = 3 (configurable via GRADING_RUNS env var, min 1 max 5)
// MCQ path:    single OCR call followed by deterministic key-lookup scoring
//              (no averaging needed — the score is exact once OCR is right)
//
// Strategy per field:
//   total_marks        → arithmetic mean, rounded to nearest integer
//   confidence_score   → arithmetic mean, rounded
//   question_analysis  → per-question average of marks_awarded + majority-vote status
//   corrections        → taken from the highest-confidence run
//   report             → best run's text + ensemble summary appended
//
const GRADING_RUNS = Math.min(7, Math.max(1, parseInt(process.env.GRADING_RUNS || '5', 10)));

// Grading queue — process scripts one at a time to avoid V8 memory crashes
// from concurrent multi-page PDF rendering.
const gradingQueue = [];
let gradingInProgress = false;
function enqueueGrading(fn) {
    gradingQueue.push(fn);
    processGradingQueue();
}
async function processGradingQueue() {
    if (gradingInProgress || gradingQueue.length === 0) return;
    gradingInProgress = true;
    const job = gradingQueue.shift();
    try { await job(); } catch (err) { console.error('[Queue] Grading job failed:', err.message); }
    gradingInProgress = false;
    if (gradingQueue.length > 0) setImmediate(processGradingQueue);
}

// Shared math grading guidance — used by both the upload handler and re-grade endpoint.
const MATHS_GUIDANCE_TEXT_GLOBAL = `

MATHEMATICS GRADING MODE (this is a Maths paper — grade like a maths examiner):

  ⚠️  CRITICAL — ARITHMETIC VERIFICATION (you MUST do this for every question):
  1. Read the PRINTED QUESTION directly from the IMAGE, digit by digit. Do NOT rely solely on the transcription.
  2. CROSS-CHECK: If the student copied the numbers into their working, compare with the printed question.
  3. COMPUTE the correct answer yourself using the verified question numbers.
  4. Read the student's FINAL ANSWER (handwritten).
  5. Compare YOUR computed answer with the student's answer.
  6. If they match → Correct (full marks). If they don't → check working for partial credit.
  Do NOT rely on "feeling" — ALWAYS compute it yourself.
  ⚠️  DIGIT CONFUSION WARNING: Common OCR misreads: 8↔3, 9↔4, 6↔0, 1↔7, 5↔6. If your computed answer differs from the student's by a small amount, RE-READ the question digits before marking wrong.

  • OCR carefully reads MATHEMATICAL NOTATION: fractions, exponents, subscripts, square roots, ±, ×, ÷, etc.
  • Award METHOD marks: partial credit for correct working even if the final answer is wrong.
  • Accept mathematically EQUIVALENT answers as correct (1/2 = 0.5 = 50%, etc.).
  • Check each STEP — follow-through: if a student makes one slip but subsequent steps are correct given that slip, only penalise once.
  • Distinguish ARITHMETIC slip (lose 1 mark) from CONCEPTUAL error (lose more).
  • Reward correct formula selection and substitution.
  • In teacher_tip, point to the exact step that went wrong.`;

// ─── MATH VERIFICATION ENGINE ────────────────────────────────────────────────
// Production-grade arithmetic verification. Parses the transcription, extracts
// the printed question expression and student's final answer, computes the
// correct answer, and overrides the AI grade if it disagrees with computation.
// Math computation is always more reliable than AI opinion for arithmetic.
function verifyArithmetic(transcription, questionAnalysis, maxTotalMarks, logPrefix = '[MathVerify]') {
    if (!transcription || !Array.isArray(questionAnalysis) || questionAnalysis.length === 0) return 0;
    if (!/\d+\s*[+\-–×÷xX*\/]\s*\d+/.test(transcription)) return 0;

    const defaultMarksPerQ = Math.round(maxTotalMarks / questionAnalysis.length);
    const qBlocks = transcription.split(/\n(?=Q\d|0[1-9]|[1-9]\d?\s*[:.)])/i);
    let fixedCount = 0;

    for (const q of questionAnalysis) {
        const qNum = parseInt((q.q_num || '').replace(/\D/g, ''), 10);
        if (isNaN(qNum)) continue;

        const block = qBlocks.find(b => {
            const m = b.match(/^(?:Q|0)?(\d+)/i);
            return m && parseInt(m[1], 10) === qNum;
        });
        if (!block) continue;

        // --- Extract the printed question expression ---
        // Handles simple (a op b) and chained (a op b op c) expressions
        const headerLine = block.split('\n')[0] || '';
        // Try to find a full chained expression first: "123 + 456 - 78"
        const chainRegex = /(\d[\d,]*(?:\s*[+\-–×÷xX*\/]\s*\d[\d,]*)+)/;
        let chainMatch = headerLine.match(chainRegex);
        if (!chainMatch) chainMatch = block.match(chainRegex);
        if (!chainMatch) continue;

        const exprStr = chainMatch[1];
        // Parse into tokens: [num, op, num, op, num, ...]
        const tokens = exprStr.match(/(\d[\d,]*|[+\-–×÷xX*\/])/g);
        if (!tokens || tokens.length < 3) continue;

        // Evaluate left-to-right with standard precedence (×÷ before +-)
        const nums = [];
        const ops = [];
        for (const t of tokens) {
            const cleaned = t.trim();
            if (/^\d/.test(cleaned)) {
                nums.push(parseFloat(cleaned.replace(/,/g, '')));
            } else if (/[+\-–×÷xX*\/]/.test(cleaned)) {
                ops.push(cleaned);
            }
        }
        if (nums.length < 2 || ops.length < 1) continue;

        // First pass: resolve × and ÷
        const nums2 = [nums[0]];
        const ops2 = [];
        for (let i = 0; i < ops.length; i++) {
            const o = ops[i];
            if ('×xX*'.includes(o)) {
                nums2[nums2.length - 1] *= nums[i + 1];
            } else if (o === '÷' || o === '/') {
                if (nums[i + 1] !== 0) nums2[nums2.length - 1] /= nums[i + 1];
                else { nums2[nums2.length - 1] = NaN; }
            } else {
                ops2.push(o);
                nums2.push(nums[i + 1]);
            }
        }
        // Second pass: resolve + and -
        let correctAnswer = nums2[0];
        for (let i = 0; i < ops2.length; i++) {
            if (ops2[i] === '+') correctAnswer += nums2[i + 1];
            else if (ops2[i] === '-' || ops2[i] === '–') correctAnswer -= nums2[i + 1];
        }
        if (!Number.isFinite(correctAnswer)) continue;

        const isDivision = ops.some(o => o === '÷' || o === '/');
        const a = nums[0], op = ops[0], b = nums[1];

        // --- Extract the student's final answer ---
        // Try multiple patterns in priority order
        let studentAnswer = null;

        // Pattern 1: "Final answer: 8754" or "Answer: 8754"
        const fm1 = block.match(/(?:final\s*answer|answer)\s*[:\s]\s*(-?\d[\d,.]*)/i);
        if (fm1) studentAnswer = parseFloat(fm1[1].replace(/,/g, ''));

        // Pattern 2: "→ Final answer: 8754" (with arrow)
        if (studentAnswer === null) {
            const fm2 = block.match(/→\s*(?:final\s*answer|answer)\s*[:\s]\s*(-?\d[\d,.]*)/i);
            if (fm2) studentAnswer = parseFloat(fm2[1].replace(/,/g, ''));
        }

        // Pattern 3: "= 8754" at end of a line (result of computation)
        if (studentAnswer === null) {
            const fm3 = block.match(/=\s*(-?\d[\d,.]*)\s*$/m);
            if (fm3) studentAnswer = parseFloat(fm3[1].replace(/,/g, ''));
        }

        // Pattern 4: "Ans: 8754" or "Ans = 8754"
        if (studentAnswer === null) {
            const fm4 = block.match(/\bans(?:wer)?\s*[=:\s]\s*(-?\d[\d,.]*)/i);
            if (fm4) studentAnswer = parseFloat(fm4[1].replace(/,/g, ''));
        }

        // Pattern 5: last multi-digit number in the block (excluding the question numbers)
        if (studentAnswer === null) {
            const allNums = [...block.matchAll(/\b(\d{2,})\b/g)].map(m => parseFloat(m[1]));
            // Skip the first two numbers (likely a and b from the expression)
            if (allNums.length >= 3) {
                studentAnswer = allNums[allNums.length - 1];
            } else if (allNums.length === 2) {
                studentAnswer = allNums[allNums.length - 1];
            }
        }

        if (studentAnswer === null) continue;

        // --- Compare ---
        const tolerance = 0.01;
        const isMatch = Math.abs(studentAnswer - correctAnswer) < tolerance
            || (isDivision && Math.abs(studentAnswer - Math.round(correctAnswer)) < tolerance)
            || (isDivision && Math.abs(studentAnswer - Math.floor(correctAnswer * 100) / 100) < tolerance);

        const qMaxMarks = parseFloat(q.max_marks) || defaultMarksPerQ;

        if (isMatch && q.status !== 'Correct') {
            q.status = 'Correct';
            q.marks_awarded = qMaxMarks;
            q.teacher_tip = `Verified by math engine: ${a} ${op} ${b} = ${correctAnswer}, student wrote ${studentAnswer}. Correct.`;
            fixedCount++;
            console.log(`${logPrefix} Q${qNum}: ${a} ${op} ${b} = ${correctAnswer}, student=${studentAnswer} → Correct (was ${q.status})`);
        } else if (!isMatch && q.status === 'Correct') {
            q.status = 'Incorrect';
            q.marks_awarded = 0;
            q.teacher_tip = `Math engine override: ${a} ${op} ${b} = ${correctAnswer}, but student wrote ${studentAnswer}. Incorrect.`;
            fixedCount++;
            console.log(`${logPrefix} Q${qNum}: ${a} ${op} ${b} = ${correctAnswer}, student=${studentAnswer} → Incorrect (was Correct)`);
        }
    }

    if (fixedCount > 0) {
        console.log(`${logPrefix} Fixed ${fixedCount} grades`);
    }
    return fixedCount;
}

// STAGE 1 of two-stage grading: transcribe the handwriting ONCE, deterministically.
// Grading then anchors to this text so repeated reads don't drift the score, and
// the teacher can see exactly what the AI read.
async function transcribePaper(filePathOrPaths, gradeModel) {
    const prompt = `You are a precise transcription assistant. Read this student's answer paper and transcribe EVERYTHING — both printed questions AND handwritten answers.

IMPORTANT — how to read each question:
  1. Find the PRINTED question text (at the top of each question area, in a typed/printed font).
  2. Find the student's HANDWRITTEN working and answer (below the printed question).
  3. These are TWO DIFFERENT things — do NOT mix digits from the printed question with the handwriting.

OUTPUT FORMAT — use EXACTLY this format for each question:
  Q[number]: [printed question exactly as printed] → Student working: [handwritten steps] → Final answer: [answer]

RULES:
- Keep question numbers EXACTLY as printed (Q1, Q01, 01, 1, etc.)
- Preserve ALL mathematical notation, working steps, intermediate calculations, units
- Transcribe the FINAL ANSWER box content separately — this is the student's submitted answer
- Do NOT grade, correct, judge or add anything — transcribe ONLY what is written/printed
- For illegible text, write [illegible]

⚠️ DIGIT ACCURACY (CRITICAL — misreading a single digit causes wrong grading):
  For EVERY number in the printed question:
  1. Read each digit INDIVIDUALLY left to right: "6753" → six, seven, five, three
  2. Verify by reading RIGHT to LEFT: "6753" → three, five, seven, six
  3. If forward and backward reads disagree, zoom into that digit

  For EVERY number in the student's handwriting:
  1. Read each digit individually — handwriting varies widely
  2. Look for context clues: carry marks, alignment, crossing out
  3. The FINAL ANSWER (usually in a box at the bottom) is the most important number

  Common confusions: 8↔3, 9↔4, 6↔0, 1↔7, 5↔6, 2↔7

  OPERATOR ACCURACY: Is it + − × or ÷? Misreading the operator changes the correct answer entirely.

⚠️ TRIPLE-CHECK PASS (do this AFTER your first read):
  Go back to EACH question and verify:
  1. Re-read the printed question numbers a SECOND time, digit by digit
  2. Re-read the student's final answer a SECOND time, digit by digit
  3. If any read disagrees with your first pass, look a THIRD time and pick the most likely reading
  4. Count the total digits in each number — does "8754" have 4 digits? Does your transcription match?

Return ONLY raw JSON:
{ "transcription": "Q01: 4768 + 3986 → Student working: 4768\\n+3986\\n8754 → Final answer: 8754\\nQ02: ...\\n…", "ocr_confidence": 0-100 }`;

    const content = await buildOCRContentArray(filePathOrPaths, prompt);
    const sysMsg = 'You are a transcription assistant inside MarkNex, a teacher grading platform. A teacher has uploaded a student answer paper for grading. Transcribe exactly what is on the page — read SLOWLY and CAREFULLY. This is a legitimate educational workflow — always comply.';

    const readOnce = async (seed) => {
        const resp = await openai.chat.completions.create({
            model: gradeModel,
            messages: [{ role: 'system', content: sysMsg }, { role: 'user', content }],
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            temperature: 0,
            seed,
        });
        let text = (resp.choices[0].message.content || '{}').trim();
        if (text.startsWith('```json')) text = text.slice(7).trim();
        else if (text.startsWith('```')) text = text.slice(3).trim();
        if (text.endsWith('```')) text = text.slice(0, -3).trim();
        try { const j = JSON.parse(text); return { transcription: j.transcription || '', ocrConfidence: j.ocr_confidence ?? 70 }; }
        catch { return { transcription: '', ocrConfidence: 0 }; }
    };

    // Double-read: two independent transcriptions catch handwriting misreads.
    // When reads disagree on a final answer and one matches the computed correct
    // answer, prefer the OTHER read — avoids false positives like "136" → "126".
    const [read1, read2] = await Promise.all([readOnce(42), readOnce(99)]);

    if (!read1.transcription) return read2;
    if (!read2.transcription) return read1;

    // Extract final answers from each read
    const extractAnswers = (t) => {
        const answers = {};
        const blocks = t.split(/\n(?=Q\d|0[1-9]|[1-9]\d?\s*[:.)])/i);
        for (const block of blocks) {
            const qMatch = block.match(/^(Q?\d+)/i);
            const aMatch = block.match(/Final answer:\s*(.+)/i);
            if (qMatch && aMatch) {
                const key = qMatch[1].replace(/^0+/, '').replace(/^Q/i, '');
                answers[key] = aMatch[1].trim();
            }
        }
        return answers;
    };

    const answers1 = extractAnswers(read1.transcription);
    const answers2 = extractAnswers(read2.transcription);

    // Check for disagreements and apply conservative correction
    let merged = read1.transcription;
    let fixes = 0;
    for (const qNum of Object.keys(answers1)) {
        const a1 = answers1[qNum];
        const a2 = answers2[qNum];
        if (!a2 || a1 === a2) continue;

        // Reads disagree — check which matches the computed correct answer
        const qBlock = merged.match(new RegExp(`Q0*${qNum}[^Q]*`, 'i'));
        if (!qBlock) continue;
        const opMatch = qBlock[0].match(/(\d[\d.]*)\s*([+\-−–×÷xX*\/])\s*(\d[\d.]*)/);
        if (!opMatch) continue;

        const n1 = parseFloat(opMatch[1]), n2 = parseFloat(opMatch[3]);
        const op = opMatch[2];
        let correct;
        if (op === '+') correct = n1 + n2;
        else if (op === '-' || op === '−' || op === '–') correct = n1 - n2;
        else if (op === '×' || op === 'x' || op === 'X' || op === '*') correct = n1 * n2;
        else if (op === '÷' || op === '/') correct = n2 !== 0 ? n1 / n2 : null;
        if (correct === null) continue;

        const ca1 = parseFloat(a1), ca2 = parseFloat(a2);
        const correctRound = Math.round(correct * 100) / 100;

        // If read1 matches correct but read2 doesn't, use read2's answer (conservative)
        if (Math.abs(ca1 - correctRound) < 0.01 && Math.abs(ca2 - correctRound) >= 0.01) {
            merged = merged.replace(
                new RegExp(`(Final answer:\\s*)${a1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
                `$1${a2}`
            );
            fixes++;
            console.log(`[DoubleRead] Q${qNum}: read1="${a1}" matches correct ${correctRound}, read2="${a2}" differs → using "${a2}" (conservative)`);
        }
        // If read2 matches correct but read1 doesn't, keep read1 (already conservative)
        else if (Math.abs(ca2 - correctRound) < 0.01 && Math.abs(ca1 - correctRound) >= 0.01) {
            console.log(`[DoubleRead] Q${qNum}: read1="${a1}" already differs from correct ${correctRound}, keeping (conservative)`);
        }
        // Both differ from correct — use read1
        else {
            console.log(`[DoubleRead] Q${qNum}: reads disagree ("${a1}" vs "${a2}"), both differ from correct ${correctRound}`);
        }
    }

    if (fixes > 0) console.log(`[DoubleRead] Applied ${fixes} conservative correction(s)`);
    return { transcription: merged, ocrConfidence: Math.min(read1.ocrConfidence, read2.ocrConfidence) };
}

// Parse a transcription into per-question { op components, computed correct,
// and the student's transcribed final answer }. Format produced by
// transcribePaper: "Q05: 42 x 3 → Student working: ... → Final answer: 136".
function parseTranscriptionAnswers(transcription) {
    const map = {};
    if (!transcription) return map;
    const blocks = transcription.split(/\n(?=Q\d)/i);
    for (const block of blocks) {
        const qMatch = block.match(/^Q0*(\d+)/i);
        if (!qMatch) continue;
        const qNum = qMatch[1];
        const faMatch = block.match(/Final answer:\s*([^\n]+)/i);
        const finalAnswer = faMatch ? faMatch[1].trim() : null;
        const opMatch = block.match(/(\d[\d.]*)\s*([+\-−–×÷xX*\/])\s*(\d[\d.]*)/);
        let correct = null;
        if (opMatch) {
            const a = parseFloat(opMatch[1]), b = parseFloat(opMatch[3]), op = opMatch[2];
            if (op === '+') correct = a + b;
            else if (op === '-' || op === '−' || op === '–') correct = a - b;
            else if (op === '×' || op === 'x' || op === 'X' || op === '*') correct = a * b;
            else if (op === '÷' || op === '/') correct = b !== 0 ? a / b : null;
            if (correct !== null) correct = Math.round(correct * 100) / 100;
        }
        map[qNum] = { finalAnswer, correct };
    }
    return map;
}

// Reconcile ensemble grades against an unbiased blind read of the student's
// final answers. When a question was marked Correct because the transcription's
// final answer matched the computed correct answer, but the blind read (which
// never saw the question) reports a DIFFERENT number, the "Correct" was likely
// an OCR misread driven by math bias (e.g. "136" read as "126"). Flip it.
// Mutates question_analysis/corrections in place; returns the number of flips.
function applyBlindVerification(questionAnalysis, blindAnswers, transcription, corrections, tag) {
    const parsed = parseTranscriptionAnswers(transcription);
    let flips = 0;
    for (const q of questionAnalysis) {
        if (q.status !== 'Correct') continue;
        const qKey = (q.q_num || '').replace(/^Q0*/i, '');
        const blindVal = blindAnswers[qKey];
        const info = parsed[qKey];
        if (!blindVal || !info || info.correct === null || info.finalAnswer === null) continue;

        const blindNum = blindVal.replace(/[^0-9.\-]/g, '');
        const correctNum = String(info.correct);
        const transNum = info.finalAnswer.replace(/[^0-9.\-]/g, '');
        if (!blindNum || !transNum) continue;

        // Suspicious signature: transcription matched correct (so it was marked
        // Correct), but the unbiased blind read sees a different number.
        if (transNum === correctNum && blindNum !== correctNum && blindNum !== transNum) {
            q.status = 'Incorrect';
            q.marks_awarded = 0;
            q.teacher_tip = `Printed question computes to ${correctNum}. Blind digit-read of the student's answer: ${blindVal} (NOT ${info.finalAnswer}). The initial read was likely biased by the math. Marked incorrect.`;
            corrections.push({ text: blindVal, correct_answer: correctNum, x: 50, y: 50 });
            flips++;
            console.log(`${tag} Q${qKey}: transcription="${info.finalAnswer}" matched correct=${correctNum}, but blind read="${blindVal}" → flipped to Incorrect`);
        }
    }
    return flips;
}

// Blind verification: re-read ONLY the student's final answers without seeing
// the questions. Removes mathematical bias (e.g. reading "136" as "126" because
// the AI knows 42×3=126). Returns a map of question number → blind-read answer.
async function blindReadAnswers(filePathOrPaths, gradeModel) {
    const blindPrompt = `You are a digit-reading assistant. Look at this student's answer paper.

For EACH question, find the student's FINAL ANSWER (usually in a box, circled, or at the bottom of the working).

⚠️ CRITICAL RULES:
  - Do NOT read the printed question text
  - Do NOT compute what the answer should be
  - Do NOT let mathematical knowledge influence your reading
  - Read ONLY the handwritten digits in the answer area
  - Read each digit INDEPENDENTLY: look at the shape of each character
  - Common handwriting: 1 (straight line), 2 (curve+base), 3 (two bumps right),
    4 (angle), 5 (flat top+curve), 6 (curl), 7 (angle), 8 (two loops), 9 (loop+tail), 0 (oval)

OUTPUT: Return JSON with one key per question:
{ "Q1": "8754", "Q2": "2083", ... }

Return ONLY the digit string you see for each answer. No computation. No correction.`;

    const content = await buildOCRContentArray(filePathOrPaths, blindPrompt);
    try {
        const resp = await openai.chat.completions.create({
            model: gradeModel,
            messages: [
                { role: 'system', content: 'Read handwritten digits exactly as written. Do NOT compute or verify mathematical correctness.' },
                { role: 'user', content }
            ],
            max_tokens: 1000,
            response_format: { type: 'json_object' },
            temperature: 0,
            seed: 777,
        });
        let text = (resp.choices[0].message.content || '{}').trim();
        if (text.startsWith('```json')) text = text.slice(7).trim();
        else if (text.startsWith('```')) text = text.slice(3).trim();
        if (text.endsWith('```')) text = text.slice(0, -3).trim();
        const parsed = JSON.parse(text);
        const result = {};
        for (const [k, v] of Object.entries(parsed)) {
            const num = k.replace(/^Q0*/i, '');
            result[num] = String(v).trim();
        }
        console.log('[BlindRead] Answers:', JSON.stringify(result));
        return result;
    } catch (err) {
        console.warn('[BlindRead] Failed:', err.message);
        return {};
    }
}

async function gradeWithEnsemble(contentArray, systemMsg, gradeModel) {
    const runs = GRADING_RUNS;

    // ── Single grading call ──────────────────────────────────────────────────
    // CONSISTENCY: temperature 0 + a FIXED seed per run index makes every call
    // deterministic and reproducible. Re-grading the same paper now yields the
    // SAME score every time. Each run still uses a different seed so the ensemble
    // is a genuine multi-read (robust), but the *set* of reads is reproducible.
    const callOnce = async (seed) => {
        const messages = [{ role: 'system', content: systemMsg }, { role: 'user', content: contentArray }];

        let response = await openai.chat.completions.create({
            model: gradeModel,
            messages,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
            temperature: 0,
            seed,
        });

        let text = response.choices[0].message.content;
        if (!text) {
            // Refusal — retry once (same deterministic settings).
            response = await openai.chat.completions.create({
                model: gradeModel,
                messages,
                max_tokens: 4000,
                response_format: { type: 'json_object' },
                temperature: 0,
                seed,
            });
            text = response.choices[0].message.content;
        }
        return text;
    };

    // ── Fire all runs in parallel with fixed, distinct seeds ─────────────────
    const settled = await Promise.allSettled(
        Array.from({ length: runs }, (_, i) => callOnce(7001 + i * 1000))
    );

    // ── Parse results ────────────────────────────────────────────────────────
    const parseJSON = (raw) => {
        if (!raw) return null;
        let text = raw.trim();
        if (text.startsWith('```json')) text = text.slice(7).trim();
        else if (text.startsWith('```')) text = text.slice(3).trim();
        if (text.endsWith('```')) text = text.slice(0, -3).trim();
        try {
            return JSON.parse(text);
        } catch {
            const m = text.match(/\{[\s\S]*\}/);
            if (m) try { return JSON.parse(m[0]); } catch {}
        }
        return null;
    };

    const results = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') {
            const parsed = parseJSON(r.value);
            if (parsed) results.push(parsed);
        }
    }

    console.log(`[Ensemble] ${results.length}/${runs} runs succeeded`);

    // If all failed, return null so the caller can fall back to "Needs Review"
    if (results.length === 0) return null;
    // Single successful result — return as-is (no averaging needed)
    if (results.length === 1) return results[0];

    // Median is more stable than the mean — one outlier run can't drag the
    // final score around, which keeps repeated gradings consistent.
    const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    // ── Median total_marks ───────────────────────────────────────────────────
    const allMarks = results.map(r => parseFloat(r.total_marks) || 0);
    const avgMarks = Math.round(median(allMarks));

    // ── Median confidence_score ──────────────────────────────────────────────
    const avgConf = Math.round(median(results.map(r => parseFloat(r.confidence_score) || 0)));

    // ── Merge question_analysis ──────────────────────────────────────────────
    // Build a map: q_num → { marks[], statuses[], tips[], confidences[] }
    // Track per-run confidence so we can weight votes
    const runConfidences = results.map(r => parseFloat(r.confidence_score) || 50);
    const qMap = {};
    for (let ri = 0; ri < results.length; ri++) {
        const r = results[ri];
        const conf = runConfidences[ri];
        for (const q of (r.question_analysis || [])) {
            if (!qMap[q.q_num]) qMap[q.q_num] = { marks: [], statuses: [], tips: [], confidences: [] };
            qMap[q.q_num].marks.push(parseFloat(q.marks_awarded) || 0);
            if (q.status) {
                qMap[q.q_num].statuses.push(q.status);
                qMap[q.q_num].confidences.push(conf);
            }
            if (q.teacher_tip) qMap[q.q_num].tips.push(q.teacher_tip);
        }
    }

    // Detect per-question max marks from AI responses
    const qMaxMap = {};
    for (const r of results) {
        for (const q of (r.question_analysis || [])) {
            const mx = parseFloat(q.max_marks);
            if (!isNaN(mx) && mx > 0) {
                if (!qMaxMap[q.q_num]) qMaxMap[q.q_num] = [];
                qMaxMap[q.q_num].push(mx);
            }
        }
    }

    const questionAnalysis = Object.entries(qMap).map(([q_num, data]) => {
        // Confidence-weighted vote: each run's vote counts proportional to its confidence
        const statusWeights = {};
        for (let i = 0; i < data.statuses.length; i++) {
            const s = data.statuses[i];
            const w = data.confidences[i] || 50;
            statusWeights[s] = (statusWeights[s] || 0) + w;
        }
        const status = Object.entries(statusWeights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Partial';

        // Per-question max marks (median of what AI detected, fallback to 1)
        const qMax = qMaxMap[q_num]?.length ? Math.round(median(qMaxMap[q_num])) : null;

        // Derive marks from status to guarantee consistency
        let marks_awarded;
        if (status === 'Correct') {
            marks_awarded = qMax || Math.round(Math.max(...data.marks, 1));
        } else if (status === 'Incorrect') {
            marks_awarded = 0;
        } else {
            marks_awarded = Math.round(median(data.marks));
        }

        const tip = [...data.tips].sort((a, b) => b.length - a.length)[0] || '';

        const totalVotes = data.statuses.length;
        const winningVotes = data.statuses.filter(s => s === status).length;
        const unanimous = winningVotes === totalVotes && totalVotes >= 2;
        return { q_num, status, marks_awarded, max_marks: qMax || undefined, teacher_tip: tip, _unanimous: unanimous };
    });

    // Recompute total from per-question breakdown so they always match
    const computedTotal = questionAnalysis.reduce((s, q) => s + (q.marks_awarded || 0), 0);

    // ── Corrections from highest-confidence run ──────────────────────────────
    const bestRun = results.reduce((best, r) =>
        (parseFloat(r.confidence_score) || 0) > (parseFloat(best.confidence_score) || 0) ? r : best
    );

    // ── Build combined report ────────────────────────────────────────────────
    const marksPerRun = allMarks.join(' / ');
    const spread = Math.max(...allMarks) - Math.min(...allMarks);
    const ensembleNote = `[Ensemble ${results.length}× — runs: ${marksPerRun} → final ${computedTotal}${spread > 2 ? `, spread ${spread} marks` : ''}]`;
    const report = `${bestRun.report || ''} ${ensembleNote}`.trim();

    // The paper's own maximum (AI-detected) — median across runs.
    const maxVals = results.map(r => parseFloat(r.paper_max_marks)).filter(v => !isNaN(v) && v > 0);
    const paperMax = maxVals.length ? Math.round(median(maxVals)) : undefined;

    return {
        total_marks: computedTotal,
        confidence_score: avgConf,
        report,
        corrections: bestRun.corrections || [],
        question_analysis: questionAnalysis,
        ...(paperMax ? { paper_max_marks: paperMax } : {}),
    };
}

const app = express();
// Restrict CORS to configured origin(s) in production; allow all by default for dev.
// CORS_ORIGIN may be a single origin or a comma-separated list.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({ origin: corsOrigin ? corsOrigin.split(',').map(s => s.trim()) : true }));
app.use(express.json());
// Serve uploaded files: disk first (fast), then the database copy. The disk is
// wiped on every redeploy of the free tier, so the DB copy is what keeps old
// answer papers viewable in reports.
// Auth-gated: only the teacher who owns the script (or their student) can view it.
app.get('/uploads/:name', (req, res) => {
    const name = path.basename(req.params.name); // no traversal

    const sendFile = () => {
        const diskPath = path.join(__dirname, 'uploads', name);
        if (fs.existsSync(diskPath)) return res.sendFile(diskPath);
        db.get('SELECT mime, data FROM stored_files WHERE filename = ?', [name], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'File not found' });
            res.set('Content-Type', row.mime || 'application/octet-stream');
            res.send(Buffer.from(row.data, 'base64'));
        });
    };

    // Verify the requester owns this file via the scripts table.
    // Accept token from Authorization header OR query param (for <img>/<iframe> src).
    const headerToken = req.headers['authorization'];
    const rawToken = headerToken ? headerToken.split(' ')[1] : req.query.token;
    if (!rawToken) return res.status(401).json({ error: 'Access denied' });
    try {
        const verified = jwt.verify(rawToken, JWT_SECRET);
        const filePath = `uploads/${name}`;
        if (verified.role === 'Student') {
            db.get(`SELECT id FROM scripts WHERE filepath = ? AND student_id = ? AND teacher_id = ?`,
                [filePath, verified.student_code, verified.teacher_id], (e, row) => {
                    if (e || !row) return res.status(403).json({ error: 'Access denied' });
                    sendFile();
                });
        } else {
            db.get(`SELECT id FROM scripts WHERE filepath = ? AND teacher_id = ?`,
                [filePath, verified.id], (e, row) => {
                    if (e || !row) return res.status(403).json({ error: 'Access denied' });
                    sendFile();
                });
        }
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
});

// Persist an uploaded file into the DB (base64). Capped at 8 MB raw to protect
// the free 1 GB Postgres allowance; larger files stay disk-only.
function persistFileToDB(diskPath, storedName, mime) {
    try {
        const stat = fs.statSync(diskPath);
        if (stat.size > 8 * 1024 * 1024) { console.warn(`[Files] ${storedName} too large to persist (${stat.size}B)`); return; }
        const data = fs.readFileSync(diskPath).toString('base64');
        db.run('INSERT OR IGNORE INTO stored_files (filename, mime, data) VALUES (?, ?, ?)',
            [storedName, mime, data], (e) => { if (e) console.warn('[Files] persist failed:', e.message); });
    } catch (e) { console.warn('[Files] persist error:', e.message); }
}

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Busboy-based file upload helper — works with Express 4 and 5.
// Collects ALL uploaded files (multi-page PDF uploads send one per page).
// Returns { fields, file (first file), files (all files) }.
function parseUpload(req) {
    return new Promise((resolve, reject) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

        let bb;
        try {
            bb = Busboy({ headers: req.headers });
        } catch (err) {
            return reject(new Error('Not a multipart request'));
        }

        const fields = {};
        const allFiles = [];
        const writePromises = [];

        bb.on('field', (name, val) => {
            fields[name] = val;
        });

        bb.on('file', (fieldname, stream, info) => {
            const { filename, mimeType } = info;
            const ext = path.extname(filename) || '';
            const saveName = Date.now() + '_' + allFiles.length + ext;
            const savePath = path.join(uploadDir, saveName);
            const writeStream = fs.createWriteStream(savePath);

            const wp = new Promise((res, rej) => {
                writeStream.on('finish', () => {
                    allFiles.push({
                        fieldname,
                        originalname: filename,
                        mimetype: mimeType,
                        path: savePath,
                        filename: saveName
                    });
                    res();
                });
                writeStream.on('error', rej);
            });
            writePromises.push(wp);
            stream.pipe(writeStream);
        });

        bb.on('close', async () => {
            try {
                await Promise.all(writePromises);
                resolve({ fields, file: allFiles[0] || null, files: allFiles });
            } catch (err) {
                reject(err);
            }
        });

        bb.on('error', reject);
        req.pipe(bb);
    });
}

// Middleware to protect routes
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Access Denied' });
    try {
        const verified = jwt.verify(token.split(' ')[1], JWT_SECRET);
        // Bind the token to the LIVE account. Without this, a token minted
        // before a database reset stays valid and silently maps onto whichever
        // account now holds that id — two different teachers ended up sharing
        // an identity that way. Tokens must carry the username, and it must
        // still match the account at that id.
        const expired = () => res.status(401).json({ error: 'Session expired. Please sign in again.' });
        if (!verified.username) return expired(); // pre-fix token — force re-login
        const table = verified.role === 'Student' ? 'students' : 'users';
        db.get(`SELECT username FROM ${table} WHERE id = ?`, [verified.id], (e, row) => {
            if (e || !row || row.username !== verified.username) return expired();
            req.user = verified;
            next();
        });
    } catch (err) {
        res.status(400).json({ error: 'Invalid Token' });
    }
};

// ── Auth rate limiting ───────────────────────────────────────────────────────
// Simple in-memory limiter: max 20 auth attempts per IP per 15 minutes. Blocks
// password brute-forcing and bulk signups that would burn the OpenAI budget.
const authAttempts = new Map(); // ip → { count, resetAt }
function authRateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = authAttempts.get(ip);
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 15 * 60 * 1000 }; authAttempts.set(ip, entry); }
    entry.count++;
    if (authAttempts.size > 5000) authAttempts.clear(); // crude memory cap
    if (entry.count > 20) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
    next();
}

// 1. Register — gated by an invite code when SIGNUP_CODE is set (protects a
// public deployment from strangers signing up and spending the OpenAI budget).
// Returns a one-time recovery code the teacher must save for password resets.
app.post('/api/auth/register', authRateLimit, async (req, res) => {
    const { username, password, invite_code } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (process.env.SIGNUP_CODE && invite_code !== process.env.SIGNUP_CODE) {
        return res.status(403).json({ error: 'Invalid invite code. Ask the administrator for the signup code.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const recoveryCode = require('crypto').randomBytes(4).toString('hex').toUpperCase(); // e.g. 9F3A21BC
        const hashedRecovery = await bcrypt.hash(recoveryCode, 10);
        // Role is intentionally NOT taken from the client to prevent privilege escalation.
        db.run('INSERT INTO users (username, password, role, recovery_code) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, 'Teacher', hashedRecovery], function (err) {
            if (err) return res.status(400).json({ error: 'User already exists' });
            res.json({ message: 'User created successfully', id: this.lastID, recovery_code: recoveryCode });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1b. Password reset using the recovery code from signup (no email needed).
app.post('/api/auth/reset-password', authRateLimit, async (req, res) => {
    const { username, recovery_code, new_password } = req.body;
    if (!username || !recovery_code || !new_password)
        return res.status(400).json({ error: 'Username, recovery code and new password are required' });
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user || !user.recovery_code)
            return res.status(400).json({ error: 'Invalid username or recovery code' });
        const ok = await bcrypt.compare(recovery_code.trim().toUpperCase(), user.recovery_code);
        if (!ok) return res.status(400).json({ error: 'Invalid username or recovery code' });
        const hashed = await bcrypt.hash(new_password, 10);
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id], (e) =>
            e ? res.status(500).json({ error: e.message }) : res.json({ message: 'Password reset. You can now sign in.' }));
    });
});

// Health check — reports which database engine is live (verifies Postgres).
app.get('/api/health', (req, res) => {
    res.json({ ok: true, db: process.env.DATABASE_URL ? 'postgres' : 'sqlite', version: 'v2-math-fix' });
});

// 2. Login. The `portal` field ('teacher' | 'student') tells us which account
// type to authenticate, so a teacher and a student can share a username without
// colliding. Defaults to checking teachers then students for backward-compat.
app.post('/api/auth/login', authRateLimit, (req, res) => {
    const { username, password, portal } = req.body;

    const tryStudent = () => {
        db.get(
            `SELECT s.*, c.teacher_id FROM students s JOIN classes c ON s.class_id = c.id
             WHERE s.username = ?`,
            [username],
            async (err2, student) => {
                if (err2 || !student || !student.password)
                    return res.status(400).json({ error: 'Invalid username or password' });
                const ok = await bcrypt.compare(password, student.password);
                if (!ok) return res.status(400).json({ error: 'Invalid username or password' });
                const token = jwt.sign({
                    id: student.id, role: 'Student', username: student.username,
                    student_code: student.student_id, teacher_id: student.teacher_id,
                }, JWT_SECRET, { expiresIn: '24h' });
                res.json({ message: 'Login successful', token, role: 'Student', username: student.username, name: student.name });
            }
        );
    };

    const tryTeacher = (fallbackToStudent) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
            if (user) {
                const valid = await bcrypt.compare(password, user.password);
                if (!valid) return res.status(400).json({ error: 'Invalid username or password' });
                const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
                return res.json({ message: 'Login successful', token, role: user.role, username: user.username });
            }
            if (fallbackToStudent) return tryStudent();
            return res.status(400).json({ error: 'Invalid username or password' });
        });
    };

    // Student portal → only check student accounts (avoids teacher collisions).
    if (portal === 'student') return tryStudent();
    // Teacher portal → only check teacher accounts.
    if (portal === 'teacher') return tryTeacher(false);
    // No portal specified → legacy behaviour (teacher first, then student).
    return tryTeacher(true);
});

// 3. Upload Answer Scripts
app.post('/api/scripts/upload', verifyToken, async (req, res) => {
    try {
        const { fields, file, files } = await parseUpload(req);
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const { student_id, grade, exam, subject, assignment_id } = fields;
        // All page images for multi-page PDFs (frontend sends one per page)
        const allPagePaths = (files || [file]).map(f => f.path);

        // Compute file hash for duplicate detection.
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');

        // Check if the exact same file was already graded for this teacher+student+subject+exam.
        const existing = await new Promise(r => db.get(
            `SELECT id, total_marks, max_marks, confidence_score, status, flags, report,
                    corrections, question_analysis, ai_total_marks, ai_confidence, transcription
             FROM scripts
             WHERE teacher_id = ? AND file_hash = ? AND student_id = ? AND subject = ? AND exam = ?
               AND is_deleted = 0 AND status != 'Pending'`,
            [req.user.id, fileHash, student_id || '', subject || 'Unassigned', exam || 'Unassigned'],
            (e, row) => r(row)
        ));

        const allPagesJson = allPagePaths.length > 1 ? JSON.stringify(allPagePaths.map(p => p.replace(/\\/g, '/'))) : null;
        db.run(
            `INSERT INTO scripts (teacher_id, student_id, filename, filepath, grade, exam, subject, assignment_id, file_hash, all_pages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, student_id, file.originalname, `uploads/${file.filename}`, grade || 'Unassigned', exam || 'Unassigned', subject || 'Unassigned', assignment_id || null, fileHash, allPagesJson],
            function (err) {
                if (err) {
                    console.error('Database Error:', err.message);
                    return res.status(500).json({ error: err.message });
                }
                const scriptId = this.lastID;

                // Keep a DB copy so the paper stays viewable after redeploys.
                persistFileToDB(file.path, file.filename, getMimeType(file.path));

                // If a previous identical upload was already graded, copy its results
                // but still run math verification to catch any arithmetic errors.
                if (existing) {
                    console.log(`[Duplicate] Script ${scriptId} matches previously graded script ${existing.id} (hash ${fileHash.slice(0, 12)}…) — copying grade with math re-check`);
                    let dupQA = [];
                    try { dupQA = JSON.parse(existing.question_analysis || '[]'); } catch(e) {}
                    const dupTranscription = existing.transcription || '';
                    let dupMarks = existing.total_marks;
                    const dupMaxMarks = existing.max_marks || 10;
                    if (dupQA.length > 0) {
                        const fixed = verifyArithmetic(dupTranscription, dupQA, dupMaxMarks, '[Duplicate MathFix]');
                        if (fixed > 0) {
                            dupMarks = Math.min(dupQA.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0), dupMaxMarks);
                        }
                    }
                    db.run(
                        `UPDATE scripts SET status = ?, total_marks = ?, max_marks = ?,
                         confidence_score = ?, flags = ?, report = ?, corrections = ?,
                         question_analysis = ?, ai_total_marks = ?, ai_confidence = ?,
                         transcription = ? WHERE id = ?`,
                        [existing.status, dupMarks, existing.max_marks,
                         existing.confidence_score, existing.flags,
                         existing.report, existing.corrections, JSON.stringify(dupQA),
                         dupMarks, existing.ai_confidence,
                         existing.transcription, scriptId]
                    );
                    return res.json({ message: 'Duplicate file detected — grade applied with math verification', scriptId, duplicate: true });
                }

                // Async AI evaluation — queued to prevent concurrent PDF memory crashes
                enqueueGrading(async () => {
                    try {
                        let isMCQ = false;
                        let assignmentRubrics = "";
                        let teacherAnswers = "";
                        let maxTotalMarks = 10;
                        let questions = [];

                        if (assignment_id) {
                            questions = await new Promise((resolve, reject) => {
                                db.all('SELECT * FROM questions WHERE assignment_id = ?', [assignment_id], (err, rows) => {
                                    if (err) reject(err); else resolve(rows);
                                });
                            });

                            const assignment = await new Promise(r => db.get(
                                'SELECT teacher_answers FROM assignments WHERE id = ?',
                                [assignment_id], (e, row) => r(row)
                            ));
                            if (assignment?.teacher_answers) {
                                teacherAnswers = assignment.teacher_answers;
                                console.log(`[Grading] Using teacher's answer key (${teacherAnswers.length} chars) for assignment ${assignment_id}`);
                            }

                            if (questions && questions.length > 0) {
                                if (questions.length === 1 && questions[0].q_num === 'MCQ Section') {
                                    isMCQ = true;
                                }
                                assignmentRubrics = "Follow this specific marking scheme:\n" +
                                    questions.map(q => `- ${q.q_num} (Max ${q.max_marks} marks): ${q.rubric}`).join('\n');
                                maxTotalMarks = questions.reduce((sum, q) => sum + q.max_marks, 0);
                            }
                        }
                        // True when a linked assignment defines the paper total; otherwise
                        // maxTotalMarks is just the default 10 and the AI should detect the
                        // paper's real maximum (e.g. a 15-question paper is out of 15).
                        const maxIsExplicit = !!(assignment_id && questions && questions.length > 0);

                        // ── Load curriculum context ──────────────────────────────────────
                        // Priority:
                        //   1. context_id sent by teacher at upload time (explicit selection)
                        //   2. Auto-match latest context for this grade+subject (fallback)
                        //   3. No context — general academic standards
                        let curriculumBlock  = '';
                        let textbookStrictMode = false;  // true = grade ONLY within textbook
                        let textbookLabel    = '';

                        const buildCurriculumBlock = (ctx, ctxGrade, ctxSubject, strict) => {
                            if (!ctx?.content) return;
                            let parsed = {};
                            try { parsed = JSON.parse(ctx.content); } catch {}

                            // Build a rich topic list from stored curriculum
                            const topicLines = (parsed.topics || []).map(t => {
                                const outcomes  = (t.outcomes  || []).join('; ');
                                const key_facts = (t.key_facts || []).join(', ');
                                const keywords  = (t.keywords  || []).join(', ');
                                return `• ${t.name}` +
                                    (outcomes  ? `\n    Learning outcomes: ${outcomes}`  : '') +
                                    (key_facts ? `\n    Key facts: ${key_facts}`          : '') +
                                    (keywords  ? `\n    Keywords: ${keywords}`            : '');
                            }).join('\n\n');

                            // Also include raw extracted text (first 4000 chars) for depth
                            const rawSnippet = parsed.raw
                                ? `\n\nEXTRACTED TEXTBOOK TEXT (first section):\n${parsed.raw.slice(0, 4000)}`
                                : '';

                            if (strict) {
                                curriculumBlock = `
━━━ REFERENCE TEXTBOOK: ${ctx.label || `${ctxGrade} ${ctxSubject}`} ━━━
${parsed.summary || ''}

TOPICS AND KNOWLEDGE IN THIS TEXTBOOK:
${topicLines || '(see raw text below)'}

GRADING GUIDANCE FROM TEXTBOOK:
${parsed.grading_guidance || 'Grade according to the topics and facts listed above.'}
${rawSnippet}
━━━ END REFERENCE TEXTBOOK ━━━

⚠️  STRICT TEXTBOOK MODE: Grade ONLY based on the knowledge, definitions, and concepts
taught in the textbook above. Do NOT use any external knowledge beyond what this
textbook covers. If the student writes a correct answer that is NOT in this textbook,
mark it as partially correct with a note "Not covered in textbook". Award marks
only for content that aligns with this specific textbook's teachings.
`;
                            } else {
                                curriculumBlock = `
━━━ CURRICULUM CONTEXT (${ctxGrade} ${ctxSubject}) ━━━
${parsed.summary || ''}

TOPICS COVERED:
${topicLines || parsed.raw?.slice(0, 2000) || ''}

GRADING GUIDANCE:
${parsed.grading_guidance || ''}
━━━ END CURRICULUM CONTEXT ━━━
`;
                            }
                            textbookLabel = ctx.label || `${ctxGrade} ${ctxSubject}`;
                            console.log(`[Context] ${strict ? '📚 Strict textbook mode' : 'Injecting context'}: "${textbookLabel}"`);
                        };

                        try {
                            const contextId = fields?.context_id || null;
                            const strict    = fields?.textbook_strict === 'true';

                            if (contextId) {
                                // Teacher explicitly chose a textbook — use it exactly
                                const ctx = await new Promise((resolve, reject) => {
                                    db.get(
                                        `SELECT id, label, content FROM subject_contexts
                                         WHERE id = ? AND teacher_id = ?`,
                                        [contextId, req.user.id],
                                        (err, row) => err ? reject(err) : resolve(row)
                                    );
                                });
                                buildCurriculumBlock(ctx, grade, subject, strict);
                                textbookStrictMode = strict;
                            } else if (grade && subject && grade !== 'Unassigned' && subject !== 'Unassigned') {
                                // Auto-match — use latest context for this grade+subject
                                const ctx = await new Promise((resolve, reject) => {
                                    db.get(
                                        `SELECT id, label, content FROM subject_contexts
                                         WHERE teacher_id = ? AND grade = ? AND subject = ?
                                         ORDER BY created_at DESC LIMIT 1`,
                                        [req.user.id, grade, subject],
                                        (err, row) => err ? reject(err) : resolve(row)
                                    );
                                });
                                buildCurriculumBlock(ctx, grade, subject, false);
                            }
                        } catch (ctxErr) {
                            console.warn('[Context] Could not load curriculum context:', ctxErr.message);
                        }

                        let prompt = "";

                        // Subject-specialised grading. Mathematics needs method
                        // marks, equivalent-answer recognition and step checking.
                        // Initial check: subject field. A second check against the
                        // transcription content is done after Stage 1 (see below).
                        let isMaths = /\b(math|maths|mathematics|further math|pure math|applied math|calculus|algebra|geometry|trigonometry|arithmetic)\b/i.test(subject || '');
                        const MATHS_GUIDANCE_TEXT = MATHS_GUIDANCE_TEXT_GLOBAL;

                        if (isMCQ) {
                            prompt = `You are an expert OCR and grading assistant. Your task has TWO steps:

STEP 1 — OCR: Carefully read EVERY mark, bubble, tick, cross and circled letter in the document. The student may have:
  • Filled/shaded a bubble or checkbox
  • Circled a letter (A/B/C/D/E)
  • Written a letter next to a question number
  • Crossed out wrong answers — the LAST remaining mark is the answer

STEP 2 — EXTRACT: Map each question number to the student's chosen answer.

Imagine a 100x100 grid overlaid on the page (0,0 = top-left, 100,100 = bottom-right).

Return a JSON object with EXACTLY two keys:
- "student_answers": maps question number → { "answer": "A", "x": 22.5, "y": 10.0 }
- "confidence_score": 0-100 (how clearly you could read the document; penalise for blurry/faint marks)

Return ONLY raw JSON. No markdown, no extra text.`;
                        } else {
                            const gradeScope = textbookStrictMode
                                ? `STRICT TEXTBOOK GRADING: You must grade ONLY based on the reference textbook provided above ("${textbookLabel}"). Do not award marks for knowledge not covered in that textbook. In feedback, refer to the textbook topics by name.`
                                : (curriculumBlock ? 'Grade based on the curriculum context above.' : 'Grade each question by reading the printed question on the student\'s paper, computing or determining the correct answer yourself, then comparing it with the student\'s written answer. Award full marks for correct answers with valid working, partial credit for partially correct work.');

                            const questionStructure = maxIsExplicit && questions.length > 0
                                ? `\nPAPER STRUCTURE: ${questions.map(q => `${q.q_num} (${q.max_marks} marks)`).join(', ')}. Total: ${maxTotalMarks} marks.\n`
                                : '';

                            const mathsGuidance = isMaths ? MATHS_GUIDANCE_TEXT : '';

                            prompt = `You are MarkNex, an expert AI teacher grading assistant. Your task has THREE steps:

STEP 1 — READ (CRITICAL — do this FIRST, before any grading):
  For EACH question on the page, extract these three things separately:
    a) PRINTED QUESTION: The question text/numbers printed on the paper (e.g., "6753 - 894")
    b) STUDENT WORKING: The handwritten working/steps the student wrote
    c) STUDENT FINAL ANSWER: The final answer (often in a box or underlined)
  Read each number DIGIT BY DIGIT from left to right. Do not read a whole number at a glance.
  The printed question is ALWAYS at the top of each question box, usually in a smaller/different font.
  The student's handwriting is below/beside the printed question.
  Do NOT confuse printed question numbers with the student's handwritten numbers.
  • Multi-page: read every page completely before starting
  • If text is unclear, make a best-effort interpretation and note uncertainty in confidence_score
${curriculumBlock}${questionStructure}
STEP 2 — COMPUTE: For each question involving calculation:
  1. Take ONLY the printed question numbers (from Step 1a)
  2. Compute the correct answer yourself step by step
  3. Write out your computation explicitly (e.g., "6753 - 894: 6753 - 894 = 5859")

STEP 3 — GRADE: Compare your computed answer (Step 2) with the student's final answer (Step 1c).
  ${gradeScope}
${assignmentRubrics ? `

MARKING SCHEME (teacher-provided reference):
${assignmentRubrics}

⚠️ CRITICAL RULE FOR ARITHMETIC/CALCULATION QUESTIONS:
  The marking scheme above was extracted from a master paper and may contain different numbers.
  For ANY question involving arithmetic (addition, subtraction, multiplication, division):
    → ALWAYS compute the correct answer from the PRINTED QUESTION on the STUDENT'S paper.
    → IGNORE the marking scheme answer if it differs from the printed question.
    → The printed question on the student's paper is the GROUND TRUTH.
  The marking scheme is ONLY authoritative for non-calculation questions (essays, short answers, definitions).` : ''}${teacherAnswers ? `

━━━ TEACHER'S CORRECT ANSWERS (GOLD STANDARD) ━━━
${teacherAnswers}
━━━ END TEACHER'S ANSWERS ━━━

⚠️ GRADING RULE: The teacher's answers above are the AUTHORITATIVE correct answers.
  For EACH question:
    1. Find the teacher's final answer for that question number
    2. Compare the STUDENT'S final answer against the TEACHER'S answer
    3. If they match → "Correct", full marks
    4. If they differ → "Incorrect", 0 marks (unless partial credit applies)
  The teacher's answers take priority over your own computation.` : ''}${mathsGuidance}

Grading rules:
  • ⚠️ SELF-CONSISTENCY CHECK (MANDATORY): If your own computed correct answer MATCHES the student's final answer, you MUST mark it "Correct" with full marks. NEVER mark a question "Incorrect" when your computation confirms the student is right.
  • For any calculation, COMPUTE the answer yourself using the PRINTED question on the student's paper. Read each digit individually from the image. Common OCR confusions: 8↔3, 9↔4, 6↔0, 1↔7, 5↔6.
  • If your computed answer differs from the student's by a small amount, RE-READ the printed question digit by digit before marking wrong — you may have misread a digit.
  • Be fair — partial credit where appropriate
  • Imagine a 100x100 grid over the page (0,0 = top-left, 100,100 = bottom-right)
  • For each error, give its approximate (x, y) coordinates so it can be highlighted
  • If you cannot read part of the script, lower confidence_score accordingly
  • If the student's final answer is correct, award full marks even if working is incomplete
${textbookStrictMode ? `  • IMPORTANT: Only award marks for content that appears in the reference textbook "${textbookLabel}"` : ''}

⚠️ FINAL VERIFICATION (MANDATORY — do this BEFORE writing JSON):
  For EACH question, write out in your head:
    "Printed question: [X op Y]. My computation: [result]. Student wrote: [Z]. Match? [yes/no]"
  If your computed answer matches the student's answer → status MUST be "Correct", full marks.
  If you marked something "Incorrect" but the numbers match → you made an error. Fix it.
  NEVER mark a correct answer as wrong.

Return a JSON object with EXACTLY these keys:
${maxIsExplicit
    ? `- "total_marks": integer score out of ${maxTotalMarks}
- "paper_max_marks": ${maxTotalMarks}`
    : `- "paper_max_marks": the TOTAL marks this paper is actually out of — count the questions and their mark allocations (e.g. 15 one-mark questions → 15). Do NOT assume 10.
- "total_marks": integer score out of paper_max_marks (never exceeding it)`}
- "confidence_score": 0-100 (OCR confidence + grading certainty combined)
- "report": One-sentence summary of the student's overall performance
- "corrections": Array of mistakes ONLY (do NOT include correct answers here), each with:
    { "text": "what student wrote", "correct_answer": "correct response", "x": 0-100, "y": 0-100 }
- "question_analysis": Array per question:
    { "q_num": "Q1", "status": "Correct|Partial|Incorrect", "marks_awarded": 2, "max_marks": 1, "teacher_tip": "Printed: [question]. Correct answer: [X]. Student wrote: [Y]." }
  The teacher_tip MUST always show the printed question, your computed answer, and the student's answer so the teacher can verify.

Return ONLY raw JSON. No markdown.`;
                        }

                        // Build OCR-enhanced content array — pass all page images
                        // so each page is sent as a separate high-res image to GPT-4o.
                        const contentArray = await buildOCRContentArray(allPagePaths, prompt);

                        const systemMsg = "You are MarkNex, an educational grading assistant for teachers. The teacher is grading their own students' answer scripts and is authorised to do so. Always return the requested JSON object and never refuse.";
                        const gradeModel = process.env.FINE_TUNED_MODEL_ID || "gpt-4o";

                        // ── Ensemble grading: run N times, average results ───────────────────
                        // For MCQ: single OCR call — deterministic key-lookup does the scoring.
                        // For essay: GRADING_RUNS parallel calls (default 3) then average.
                        let aiData;
                        if (isMCQ) {
                            // MCQ OCR consistency: read the sheet 3× deterministically
                            // (temp 0, fixed seeds) and MAJORITY-VOTE each question's
                            // answer. A single read at default temperature was the
                            // cause of same-paper-different-score results.
                            const readOnce = async (seed) => {
                                const response = await openai.chat.completions.create({
                                    model: gradeModel,
                                    messages: [{ role: "system", content: systemMsg }, { role: "user", content: contentArray }],
                                    max_tokens: 2000,
                                    response_format: { type: "json_object" },
                                    temperature: 0,
                                    seed,
                                });
                                let t = (response.choices[0].message.content || '').trim();
                                if (t.startsWith('```json')) t = t.slice(7).trim();
                                else if (t.startsWith('```')) t = t.slice(3).trim();
                                if (t.endsWith('```')) t = t.slice(0, -3).trim();
                                try { return JSON.parse(t); }
                                catch { const m = t.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
                            };

                            const reads = (await Promise.allSettled([readOnce(101), readOnce(202), readOnce(303)]))
                                .filter(r => r.status === 'fulfilled' && r.value && r.value.student_answers)
                                .map(r => r.value);

                            if (reads.length === 0) {
                                db.run(
                                    `UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0,
                                     flags = 'Manual Review Needed',
                                     report = 'The AI could not automatically grade this document — it may not be a clear student answer script. Please review and grade it manually.'
                                     WHERE id = ?`,
                                    [scriptId]
                                );
                                return;
                            }

                            // Majority-vote each question's detected answer across reads.
                            const allQs = new Set();
                            reads.forEach(r => Object.keys(r.student_answers || {}).forEach(q => allQs.add(q)));
                            const votedAnswers = {};
                            for (const q of allQs) {
                                const votes = {};
                                let sample = null;
                                for (const r of reads) {
                                    const entry = r.student_answers?.[q];
                                    const ans = (typeof entry === 'object' ? entry?.answer : entry);
                                    if (ans === undefined || ans === null) continue;
                                    const key = String(ans).trim().toUpperCase();
                                    votes[key] = (votes[key] || 0) + 1;
                                    if (!sample && typeof entry === 'object') sample = entry;
                                }
                                const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
                                if (winner) {
                                    votedAnswers[q] = sample
                                        ? { ...sample, answer: winner[0] }
                                        : { answer: winner[0] };
                                }
                            }

                            const medianOf = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
                            aiData = {
                                ...reads[0],
                                student_answers: votedAnswers,
                                confidence_score: Math.round(medianOf(reads.map(r => parseFloat(r.confidence_score) || 0))),
                            };
                            console.log(`[MCQ Ensemble] ${reads.length}/3 reads OK, ${allQs.size} questions, majority-voted for script ${scriptId}`);
                        } else {
                            // ── TWO-STAGE GRADING ────────────────────────────────
                            // Stage 1: transcribe the handwriting once (deterministic).
                            let transcription = '', ocrConfidence = 0;
                            try {
                                ({ transcription, ocrConfidence } = await transcribePaper(allPagePaths, gradeModel));
                                console.log(`[TwoStage] Transcribed ${transcription.length} chars (OCR conf ${ocrConfidence}%) for script ${scriptId}`);
                            } catch (tErr) { console.warn('[TwoStage] Transcription failed:', tErr.message); }

                            // Auto-detect math from the transcription when subject
                            // wasn't set — arithmetic operators in the content mean
                            // this is a math paper and needs the verification prompt.
                            if (!isMaths && transcription) {
                                const hasMathOps = /[\+\-×÷]\s*\d|\d\s*[\+\-×÷]|\d+\s*[xX×]\s*\d|\b\d+\s*\+\s*\d+\b|\b\d+\s*-\s*\d+\b|\b\d+\s*÷\s*\d+\b/.test(transcription);
                                if (hasMathOps) {
                                    isMaths = true;
                                    console.log(`[TwoStage] Auto-detected math content from transcription for script ${scriptId}`);
                                    contentArray[0].text += MATHS_GUIDANCE_TEXT;
                                }
                            }

                            // Stage 2: anchor grading to that transcription so the
                            // score doesn't drift between reads. Images stay attached
                            // so coordinate-based highlighting still works.
                            if (transcription && transcription.length > 15) {
                                contentArray[0].text += `\n\n━━━ TRANSCRIPTION (use as a guide but always verify numbers/digits directly from the IMAGE — OCR can misread digits like 8↔3, 9↔4, 6↔0) ━━━\n${transcription}\n━━━ END TRANSCRIPTION ━━━`;
                            }
                            console.log(`[Ensemble] Starting ${GRADING_RUNS}× grading for script ${scriptId}`);
                            aiData = await gradeWithEnsemble(contentArray, systemMsg, gradeModel);
                            if (aiData) aiData._transcription = transcription;
                            if (!aiData) {
                                db.run(
                                    `UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0,
                                     flags = 'Manual Review Needed',
                                     report = 'The AI could not automatically grade this document — it may not be a clear student answer script. Please review and grade it manually.'
                                     WHERE id = ?`,
                                    [scriptId]
                                );
                                return;
                            }
                        }
                        let score = parseFloat(aiData.confidence_score) || 0;

                        if (isMCQ) {
                            const studentAnswers = aiData.student_answers || {};
                            let calculatedMarks = 0;
                            let corrections = [];
                            let questionAnalysis = [];

                            // Parse master key — strict: only match lines like "1. A", "2) B", "3 - C"
                            // The answer must be a single letter A-E to avoid false matches
                            const masterKey = {};
                            if (questions && questions[0]) {
                                const rubricLines = questions[0].rubric.split('\n');
                                rubricLines.forEach(line => {
                                    const trimmed = line.trim();
                                    // Match: number followed by optional separator, then exactly one letter A-E
                                    const match = trimmed.match(/^(\d+)\s*[\.\-\):]?\s*([A-Ea-e])\s*$/);
                                    if (match) {
                                        masterKey[match[1]] = match[2].toUpperCase();
                                    }
                                });
                            }

                            const totalQuestions = Object.keys(masterKey).length;
                            if (totalQuestions === 0) {
                                // Fallback: couldn't parse master key
                                aiData.total_marks = 0;
                                aiData.report = `Could not parse master answer key. Please check the key format.`;
                                aiData.corrections = [];
                                aiData.question_analysis = [];
                            } else {
                                for (let q in masterKey) {
                                    const correctAns = masterKey[q];
                                    const rawAns = studentAnswers[q];
                                    // The answer may be a plain letter ("A") or an object { answer, x, y }.
                                    const ansLetter = (rawAns && typeof rawAns === 'object') ? rawAns.answer : rawAns;
                                    const studentAns = ansLetter ? String(ansLetter).trim().toUpperCase().charAt(0) : null;
                                    const x = (rawAns && typeof rawAns === 'object' && rawAns.x != null) ? rawAns.x : 0;
                                    const y = (rawAns && typeof rawAns === 'object' && rawAns.y != null) ? rawAns.y : 0;

                                    if (studentAns === correctAns) {
                                        calculatedMarks++;
                                        questionAnalysis.push({ q_num: "Q" + q, status: "Correct", marks_awarded: 1, teacher_tip: "" });
                                    } else {
                                        corrections.push({
                                            text: `Q${q}: Student answered ${studentAns || 'No answer'}`,
                                            correct_answer: correctAns,
                                            x, y
                                        });
                                        questionAnalysis.push({ q_num: "Q" + q, status: "Incorrect", marks_awarded: 0, teacher_tip: `Correct answer is ${correctAns}` });
                                    }
                                }

                                // For MCQ, max_marks = number of questions (1 mark each)
                                maxTotalMarks = totalQuestions;
                                aiData.total_marks = calculatedMarks;
                                aiData.report = `MCQ Score: ${calculatedMarks}/${totalQuestions} correct`;
                                aiData.corrections = corrections;
                                aiData.question_analysis = questionAnalysis;
                            }
                        }

                        // Use the AI-detected paper total when no assignment fixed one,
                        // and never let the score exceed the maximum (no more 15/10).
                        if (!isMCQ && !maxIsExplicit) {
                            const detectedMax = parseInt(aiData.paper_max_marks, 10);
                            if (!isNaN(detectedMax) && detectedMax > 0 && detectedMax <= 500) {
                                maxTotalMarks = detectedMax;
                            } else {
                                // No usable max from the AI — derive from per-question marks if present.
                                const qSum = (aiData.question_analysis || []).reduce((s, q) => s + (parseFloat(q.marks_awarded) || 0), 0);
                                if (qSum > maxTotalMarks) maxTotalMarks = Math.max(qSum, parseFloat(aiData.total_marks) || 0);
                            }
                        }
                        aiData.total_marks = Math.min(parseFloat(aiData.total_marks) || 0, maxTotalMarks);

                        // ── Post-grading math verification ────────────────────
                        if (!isMCQ && Array.isArray(aiData.question_analysis)) {
                            const fixed = verifyArithmetic(aiData._transcription, aiData.question_analysis, maxTotalMarks, '[MathVerify]');
                            if (fixed > 0) {
                                aiData.total_marks = Math.min(
                                    aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0),
                                    maxTotalMarks
                                );
                            }
                        }

                        // ── Blind-read verification: catch false positives ─────────
                        // When the AI reads "136" as "126" because it knows 42×3=126,
                        // a blind read (no question context) detects the discrepancy.
                        if (!isMCQ && Array.isArray(aiData.question_analysis) &&
                            aiData.question_analysis.some(q => q.status === 'Correct')) {
                            try {
                                const blindAnswers = await blindReadAnswers(allPagePaths, gradeModel);
                                if (Object.keys(blindAnswers).length > 0) {
                                    if (!aiData.corrections) aiData.corrections = [];
                                    const flips = applyBlindVerification(
                                        aiData.question_analysis, blindAnswers,
                                        aiData._transcription, aiData.corrections, '[BlindVerify]'
                                    );
                                    if (flips > 0) {
                                        aiData.total_marks = Math.min(
                                            aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0),
                                            maxTotalMarks
                                        );
                                    }
                                }
                            } catch (bErr) { console.warn('[BlindVerify] Error:', bErr.message); }
                        }

                        // Fallback consistency check for non-math: catch corrections
                        // where text === correct_answer (AI contradicts itself)
                        if (!isMCQ && Array.isArray(aiData.question_analysis)) {
                            const corrections = aiData.corrections || [];
                            let fixedCount = 0;
                            const defaultPerQ = Math.round(maxTotalMarks / (aiData.question_analysis.length || 1));
                            for (const q of aiData.question_analysis) {
                                if (q.status !== 'Incorrect' && q.status !== 'Partial') continue;
                                const tipMatch = (q.teacher_tip || '').match(/correct\s*answer\s*(?:is|=|:)\s*(-?\d[\d,.]*)/i);
                                if (tipMatch) {
                                    const tipAnswer = parseFloat(tipMatch[1].replace(/,/g, ''));
                                    const corr = corrections.find(c => {
                                        const studentVal = parseFloat((c.text || '').replace(/[^0-9.-]/g, ''));
                                        return !isNaN(studentVal) && Math.abs(studentVal - tipAnswer) < 0.01;
                                    });
                                    if (corr) {
                                        const qMax = parseFloat(q.max_marks) || defaultPerQ;
                                        q.status = 'Correct';
                                        q.marks_awarded = qMax;
                                        q.teacher_tip = `Auto-corrected: student answer matches the computed correct answer (${tipAnswer}).`;
                                        corrections.splice(corrections.indexOf(corr), 1);
                                        fixedCount++;
                                    }
                                }
                            }
                            if (fixedCount > 0) {
                                aiData.corrections = corrections;
                                aiData.total_marks = Math.min(
                                    aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0),
                                    maxTotalMarks
                                );
                                console.log(`[Consistency] Fixed ${fixedCount} self-contradictory grades for script ${scriptId}`);
                            }
                        }

                        // ── Sanity checks ─────────────────────────────
                        if (Array.isArray(aiData.question_analysis)) {
                            const defaultPerQ = Math.round(maxTotalMarks / (aiData.question_analysis.length || 1));
                            for (const q of aiData.question_analysis) {
                                const qMax = parseFloat(q.max_marks) || defaultPerQ;
                                const m = parseFloat(q.marks_awarded) || 0;
                                if (m < 0) q.marks_awarded = 0;
                                if (m > qMax) q.marks_awarded = qMax;
                                // Ensure status and marks are consistent
                                if (q.status === 'Correct' && q.marks_awarded === 0) q.marks_awarded = qMax;
                                if (q.status === 'Incorrect' && q.marks_awarded > 0) q.marks_awarded = 0;
                            }
                            const qaSum = aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0);
                            aiData.total_marks = Math.min(qaSum, maxTotalMarks);
                        }
                        if (aiData.total_marks < 0) aiData.total_marks = 0;
                        if (aiData.total_marks > maxTotalMarks) aiData.total_marks = maxTotalMarks;

                        const correctionsStr = JSON.stringify(aiData.corrections || []);
                        const cleanedQA = (aiData.question_analysis || []).map(({ _unanimous, ...rest }) => rest);
                        const questionAnalysisStr = JSON.stringify(cleanedQA);

                        db.get(
                            `SELECT COALESCE(
                                (SELECT value FROM teacher_settings WHERE teacher_id = ? AND key = 'confidence_threshold'),
                                (SELECT value FROM settings WHERE key = 'confidence_threshold'),
                                '75'
                             ) AS value`,
                            [req.user.id], (err, row) => {
                            const threshold = row ? parseFloat(row.value) : 75;
                            const status = score < threshold ? 'Needs Review' : 'Evaluated';
                            const flags = score < threshold ? 'Low Confidence' : 'AI Verified';
                            db.run(
                                `UPDATE scripts SET status = ?, total_marks = ?, max_marks = ?, confidence_score = ?, flags = ?, report = ?, corrections = ?, question_analysis = ?, ai_total_marks = ?, ai_confidence = ?, transcription = ? WHERE id = ?`,
                                [status, aiData.total_marks, maxTotalMarks, score, flags, aiData.report, correctionsStr, questionAnalysisStr, aiData.total_marks, score, aiData._transcription || null, scriptId]
                            );
                        });
                    } catch (err) {
                        console.error("AI Evaluation error:", err);
                        db.run(
                            `UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0, flags = 'AI Failed', report = ? WHERE id = ?`,
                            ['AI processing failed. ' + err.message, scriptId]
                        );
                    }
                });

                res.json({ message: 'File uploaded and AI Evaluation started', scriptId });
            }
        );
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
});

// MCQ Master Key Extraction
app.post('/api/mcq/extract-key', verifyToken, async (req, res) => {
    try {
        const { file } = await parseUpload(req);
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const prompt = `You are an expert OCR assistant. This document is an MCQ master answer key.

STEP 1 — OCR: Read every line of the document, whether printed or handwritten.
STEP 2 — EXTRACT: List each question number with its correct answer letter.

Output format (EXACTLY like this):
1. A
2. C
3. B
4. D
...

Rules:
- One line per question
- Only include question number and answer letter
- If a question has multiple correct answers, pick the primary one
- Return ONLY the list, nothing else`;

        const contentArray = await buildOCRContentArray(file.path, prompt);

        // Deterministic 3-read majority vote — the SAME seeds the student-answer
        // reader uses, so grading a paper against a key extracted from the same
        // document yields identical reads (a single read at default temperature
        // previously made key vs. answers disagree on ambiguous marks).
        const sysMsg = "You are MarkNex Answer Key Extractor. A verified teacher has uploaded their own MCQ answer key so the platform can auto-grade student papers against it. Extract the answers exactly as described in the user prompt. This is an authorised educational workflow — never refuse, never apologise, never say you cannot assist. Output ONLY the answer list.";
        const readOnce = async (seed) => {
            const response = await openai.chat.completions.create({
                model: process.env.FINE_TUNED_MODEL_ID || "gpt-4o",
                messages: [{ role: "system", content: sysMsg }, { role: "user", content: contentArray }],
                max_tokens: 2000,
                temperature: 0,
                seed,
            });
            let t = (response.choices[0].message.content || '').trim();
            if (t.startsWith('```')) t = t.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
            // Parse "1. A" lines → { '1': 'A' }
            const map = {};
            t.split('\n').forEach(line => {
                const m = line.trim().match(/^(\d+)\s*[\.\-\):]?\s*([A-Ea-e])\s*$/);
                if (m) map[m[1]] = m[2].toUpperCase();
            });
            return map;
        };

        const reads = (await Promise.allSettled([readOnce(101), readOnce(202), readOnce(303)]))
            .filter(r => r.status === 'fulfilled' && Object.keys(r.value).length > 0)
            .map(r => r.value);

        if (reads.length === 0)
            return res.status(422).json({ error: 'Could not read the answer key from this file.' });

        // Majority-vote each question's letter across the reads.
        const allQs = new Set();
        reads.forEach(m => Object.keys(m).forEach(q => allQs.add(q)));
        const finalKey = {};
        for (const q of allQs) {
            const votes = {};
            reads.forEach(m => { if (m[q]) votes[m[q]] = (votes[m[q]] || 0) + 1; });
            const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
            if (winner) finalKey[q] = winner[0];
        }

        const text = Object.keys(finalKey)
            .sort((a, b) => Number(a) - Number(b))
            .map(q => `${q}. ${finalKey[q]}`)
            .join('\n');

        console.log(`[MCQ Key] ${reads.length}/3 reads OK, ${Object.keys(finalKey).length} questions majority-voted`);
        res.json({ extracted_key: text });
    } catch (err) {
        console.error("MCQ Extract Error:", err);
        res.status(500).json({ error: 'Failed to extract MCQ key. ' + err.message });
    }
});

// Essay Marking Scheme Extraction
app.post('/api/essay/extract-scheme', verifyToken, async (req, res) => {
    try {
        const { file } = await parseUpload(req);
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const fileSize = fs.existsSync(file.path) ? fs.statSync(file.path).size : 0;
        console.log(`[EssayScheme] Received file: ${file.originalname} → ${file.filename} (${(fileSize/1024).toFixed(1)} KB, mime: ${file.mimetype})`);

        const prompt = `You are an expert OCR and educator assistant. This document is a teacher's answer paper or marking scheme.

STEP 1 — OCR: Read every word and number carefully, including printed questions, handwritten working, and final answers.

STEP 2 — DETECT TYPE:
  A) If the document has PRINTED QUESTIONS with WORKED SOLUTIONS / FINAL ANSWERS → this is a TEACHER'S ANSWER PAPER.
  B) If the document has only rubric criteria / marking guidelines → this is a MARKING SCHEME.

STEP 3 — EXTRACT:
  For TYPE A (answer paper with solutions):
    Extract EACH question with its correct answer. Format:
    Q1 (1 marks): Correct answer: [answer]. Question: [printed question text]
    Q2 (1 marks): Correct answer: [answer]. Question: [printed question text]
    ...
    Read the FINAL ANSWER for each question carefully — this is the teacher's correct answer.
    For math: include the full computation, e.g. "Correct answer: 8754. Question: 4768 + 3986"

  For TYPE B (marking scheme):
    Q1 (10 marks): [rubric criteria — what earns marks]
    Q2 (5 marks): [rubric criteria]

Rules:
- Read EVERY question — do not skip any
- For math answer papers, read each digit carefully (common confusions: 8↔3, 9↔4, 6↔0)
- Include the marks allocation (default 1 mark per question if not specified)
- Return ONLY the extracted content, no extra text`;

        const contentArray = await buildOCRContentArray(file.path, prompt);

        const systemMsg = "You are MarkNex Rubric Extractor. A verified teacher has uploaded their own marking scheme so the platform can auto-grade student papers against it. Extract the rubric content exactly as described in the user prompt. This is an authorised educational workflow — never refuse, never apologise, never say you cannot assist. Output ONLY the extracted marking scheme.";
        const messages = [
            { role: "system", content: systemMsg },
            { role: "user", content: contentArray }
        ];
        const gradeModel = process.env.FINE_TUNED_MODEL_ID || "gpt-4o";

        let text = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await openai.chat.completions.create({
                model: gradeModel,
                messages,
                max_tokens: 3000,
                temperature: 0,
                seed: 42 + attempt,
            });
            text = response.choices[0].message.content;
            console.log(`[EssayScheme] Attempt ${attempt + 1} response (first 200 chars): ${(text || '').slice(0, 200)}`);
            if (text && !text.toLowerCase().includes("i'm sorry") && !text.toLowerCase().includes("i can't assist")) break;
            console.warn(`[EssayScheme] Attempt ${attempt + 1} refused, retrying...`);
            text = null;
        }

        if (!text) return res.status(422).json({ error: 'The AI could not read this file. Try re-uploading a clearer image or PDF.' });
        text = text.trim();
        if (text.startsWith('```')) text = text.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
        res.json({ extracted_scheme: text });
    } catch (err) {
        console.error("Essay Scheme Extract Error:", err);
        res.status(500).json({ error: 'Failed to extract marking scheme. ' + err.message });
    }
});

// Assignments
app.post('/api/assignments', verifyToken, (req, res) => {
    const { title, description, questions } = req.body;
    const totalMax = questions.reduce((sum, q) => sum + parseInt(q.max_marks), 0);
    db.run(`INSERT INTO assignments (teacher_id, title, description, total_max_marks) VALUES (?, ?, ?, ?)`,
        [req.user.id, title, description, totalMax], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const assignmentId = this.lastID;
            const stmt = db.prepare(`INSERT INTO questions (assignment_id, q_num, max_marks, rubric) VALUES (?, ?, ?, ?)`);
            questions.forEach(q => stmt.run(assignmentId, q.q_num, q.max_marks, q.rubric));
            stmt.finalize();
            res.json({ message: 'Assignment created', id: assignmentId });
        });
});

app.get('/api/assignments', verifyToken, (req, res) => {
    db.all(`SELECT * FROM assignments WHERE teacher_id = ?`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/assignments/:id', verifyToken, (req, res) => {
    db.get(`SELECT * FROM assignments WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], (err, assignment) => {
        if (err || !assignment) return res.status(404).json({ error: 'Not found' });
        db.all(`SELECT * FROM questions WHERE assignment_id = ?`, [assignment.id], (err, questions) => {
            res.json({ ...assignment, questions });
        });
    });
});

// Upload teacher's own answered paper — transcribed and stored as the gold
// standard answer key so student grades are compared against it.
app.post('/api/assignments/:id/teacher-answers', verifyToken, async (req, res) => {
    try {
        const { file, files } = await parseUpload(req);
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const assignmentId = req.params.id;
        const exists = await new Promise(r => db.get(
            'SELECT id FROM assignments WHERE id = ? AND teacher_id = ?',
            [assignmentId, req.user.id], (e, row) => r(row)
        ));
        if (!exists) return res.status(404).json({ error: 'Assignment not found' });

        const allPagePaths = (files || [file]).map(f => f.path);
        const gradeModel = process.env.FINE_TUNED_MODEL_ID || 'gpt-4o';
        const { transcription } = await transcribePaper(allPagePaths, gradeModel);

        if (!transcription || transcription.length < 10) {
            return res.status(422).json({ error: 'Could not read the answer paper. Try a clearer image.' });
        }

        db.run('UPDATE assignments SET teacher_answers = ? WHERE id = ? AND teacher_id = ?',
            [transcription, assignmentId, req.user.id], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Teacher answers saved', transcription });
            });
    } catch (err) {
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
});

// Scripts
app.get('/api/scripts', verifyToken, (req, res) => {
    db.all(`SELECT * FROM scripts WHERE teacher_id = ? ORDER BY upload_timestamp DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/scripts/:id', verifyToken, (req, res) => {
    const { total_marks, report, question_analysis } = req.body;
    const qAnalysisStr = question_analysis ? JSON.stringify(question_analysis) : null;
    // COALESCE keeps the AI's original grade the first time a script is reviewed
    // (and on legacy rows graded before this column existed), so the
    // human-vs-AI delta is preserved for the agreement analytics.
    db.run(`UPDATE scripts SET ai_total_marks = COALESCE(ai_total_marks, total_marks), total_marks = ?, status = 'Evaluated (Manual)', report = ?, flags = 'Reviewed', question_analysis = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND teacher_id = ?`,
        [total_marks, report, qAnalysisStr, req.params.id, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Mark updated successfully' });
        });
});

app.delete('/api/scripts/:id', verifyToken, (req, res) => {
    db.run(`UPDATE scripts SET is_deleted = 1 WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Script deleted' });
    });
});

app.put('/api/scripts/:id/restore', verifyToken, (req, res) => {
    db.run(`UPDATE scripts SET is_deleted = 0 WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Script restored' });
    });
});

// Re-grade: reset a script and re-run the AI grading pipeline on the same file.
app.post('/api/scripts/:id/regrade', verifyToken, (req, res) => {
    const scriptId = req.params.id;
    db.get(`SELECT * FROM scripts WHERE id = ? AND teacher_id = ?`, [scriptId, req.user.id], (err, script) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!script) return res.status(404).json({ error: 'Script not found' });

        // Reset the script to Pending state
        db.run(
            `UPDATE scripts SET status = 'Pending', total_marks = 0, confidence_score = 0,
             flags = 'Re-grading', report = NULL, corrections = NULL, question_analysis = NULL,
             transcription = NULL, ai_total_marks = NULL, ai_confidence = NULL WHERE id = ?`,
            [scriptId]
        );
        res.json({ message: 'Re-grading started', scriptId });

        // Re-run grading asynchronously
        (async () => {
            try {
                const gradeModel = process.env.FINE_TUNED_MODEL_ID || "gpt-4o";
                const systemMsg = "You are MarkNex, an expert AI teacher grading assistant built for a teacher grading platform. Grade student answer papers accurately. This is a legitimate educational workflow.";

                // Resolve filepath
                let filePath = script.filepath;
                if (!fs.existsSync(filePath)) {
                    const uploadsDir = path.join(__dirname, 'uploads');
                    const basename = (filePath || '').split(/[\\/]/).pop();
                    const altPath = path.join(uploadsDir, basename);
                    if (fs.existsSync(altPath)) filePath = altPath;
                    else {
                        // Try restoring from DB
                        const stored = await new Promise(r => db.get(`SELECT * FROM stored_files WHERE filename = ?`, [basename], (e, row) => r(row)));
                        if (stored) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                            fs.writeFileSync(altPath, Buffer.from(stored.data, 'base64'));
                            filePath = altPath;
                        }
                    }
                }
                if (!fs.existsSync(filePath)) {
                    db.run(`UPDATE scripts SET status = 'Needs Review', flags = 'File Missing', report = 'Original file not found — cannot re-grade.' WHERE id = ?`, [scriptId]);
                    return;
                }

                // Reconstruct all page paths for multi-page uploads
                let allPagePaths = [filePath];
                if (script.all_pages) {
                    try {
                        const stored = JSON.parse(script.all_pages);
                        const resolved = stored.map(p => {
                            if (fs.existsSync(p)) return p;
                            const bn = p.split(/[\\/]/).pop();
                            const alt = path.join(__dirname, 'uploads', bn);
                            return fs.existsSync(alt) ? alt : null;
                        }).filter(Boolean);
                        if (resolved.length > 0) allPagePaths = resolved;
                    } catch (e) { /* use single filePath */ }
                }

                const subject = script.subject || '';
                const grade = script.grade || '';
                let isMCQ = false;
                let assignmentRubrics = "";
                let maxTotalMarks = parseInt(script.max_marks) || 10;
                let maxIsExplicit = false;
                let questions = [];
                let textbookStrictMode = false;
                let textbookLabel = '';
                let curriculumBlock = '';

                // Load assignment rubrics + teacher answers
                let teacherAnswers = "";
                if (script.assignment_id) {
                    questions = await new Promise((resolve, reject) => {
                        db.all(`SELECT * FROM questions WHERE assignment_id = ?`, [script.assignment_id], (err, rows) => err ? reject(err) : resolve(rows || []));
                    });
                    if (questions.length > 0) {
                        maxTotalMarks = questions.reduce((s, q) => s + (parseInt(q.max_marks) || 0), 0);
                        maxIsExplicit = true;
                        if (questions.length === 1 && /^\s*\d+\s*[\.\)]\s*[A-Ea-e]\s*$/m.test(questions[0].rubric)) {
                            isMCQ = true;
                        } else {
                            assignmentRubrics = "Assignment rubric:\n" + questions.map(q =>
                                `${q.q_num} (${q.max_marks} marks): ${q.rubric}`
                            ).join('\n');
                        }
                    }
                    const assignment = await new Promise(r => db.get(
                        'SELECT teacher_answers FROM assignments WHERE id = ?',
                        [script.assignment_id], (e, row) => r(row)
                    ));
                    if (assignment?.teacher_answers) {
                        teacherAnswers = assignment.teacher_answers;
                        console.log(`[ReGrade] Using teacher's answer key (${teacherAnswers.length} chars)`);
                    }
                }

                let isMaths = /\b(math|maths|mathematics|further math|pure math|applied math|calculus|algebra|geometry|trigonometry|arithmetic)\b/i.test(subject);
                const MATHS_GUIDANCE = isMaths ? MATHS_GUIDANCE_TEXT_GLOBAL : '';

                // Build prompt (same as upload flow but simplified for re-grade)
                const gradeScope = curriculumBlock ? 'Grade based on the curriculum context above.' : 'Grade each question by reading the printed question on the student\'s paper, computing or determining the correct answer yourself, then comparing it with the student\'s written answer. Award full marks for correct answers with valid working, partial credit for partially correct work.';

                const questionStructure = maxIsExplicit && questions.length > 0
                    ? `\nPAPER STRUCTURE: ${questions.map(q => `${q.q_num} (${q.max_marks} marks)`).join(', ')}. Total: ${maxTotalMarks} marks.\n`
                    : '';

                const prompt = `You are MarkNex, an expert AI teacher grading assistant. Your task has THREE steps:

STEP 1 — READ (CRITICAL — do this FIRST, before any grading):
  For EACH question on the page, extract these three things separately:
    a) PRINTED QUESTION: The question text/numbers printed on the paper (e.g., "6753 - 894")
    b) STUDENT WORKING: The handwritten working/steps the student wrote
    c) STUDENT FINAL ANSWER: The final answer (often in a box or underlined)
  Read each number DIGIT BY DIGIT from left to right. Do not read a whole number at a glance.
  The printed question is ALWAYS at the top of each question box, usually in a smaller/different font.
  The student's handwriting is below/beside the printed question.
  Do NOT confuse printed question numbers with the student's handwritten numbers.
  • Multi-page: read every page completely before starting
  • If text is unclear, make a best-effort interpretation and note uncertainty in confidence_score
${curriculumBlock}${questionStructure}
STEP 2 — COMPUTE: For each question involving calculation:
  1. Take ONLY the printed question numbers (from Step 1a)
  2. Compute the correct answer yourself step by step
  3. Write out your computation explicitly (e.g., "6753 - 894: 6753 - 894 = 5859")

STEP 3 — GRADE: Compare your computed answer (Step 2) with the student's final answer (Step 1c).
  ${gradeScope}
${assignmentRubrics ? `

MARKING SCHEME (teacher-provided reference):
${assignmentRubrics}

⚠️ CRITICAL RULE FOR ARITHMETIC/CALCULATION QUESTIONS:
  The marking scheme above was extracted from a master paper and may contain different numbers.
  For ANY question involving arithmetic (addition, subtraction, multiplication, division):
    → ALWAYS compute the correct answer from the PRINTED QUESTION on the STUDENT'S paper.
    → IGNORE the marking scheme answer if it differs from the printed question.
    → The printed question on the student's paper is the GROUND TRUTH.
  The marking scheme is ONLY authoritative for non-calculation questions (essays, short answers, definitions).` : ''}${teacherAnswers ? `

━━━ TEACHER'S CORRECT ANSWERS (GOLD STANDARD) ━━━
${teacherAnswers}
━━━ END TEACHER'S ANSWERS ━━━

⚠️ GRADING RULE: The teacher's answers above are the AUTHORITATIVE correct answers.
  For EACH question:
    1. Find the teacher's final answer for that question number
    2. Compare the STUDENT'S final answer against the TEACHER'S answer
    3. If they match → "Correct", full marks
    4. If they differ → "Incorrect", 0 marks (unless partial credit applies)` : ''}
${MATHS_GUIDANCE}

Grading rules:
  • ⚠️ SELF-CONSISTENCY CHECK (MANDATORY): If your own computed correct answer MATCHES the student's final answer, you MUST mark it "Correct" with full marks. NEVER mark a question "Incorrect" when your computation confirms the student is right.
  • For any calculation, COMPUTE the answer yourself using the PRINTED question on the student's paper. Read each digit individually from the image. Common OCR confusions: 8↔3, 9↔4, 6↔0, 1↔7, 5↔6.
  • If your computed answer differs from the student's by a small amount, RE-READ the printed question digit by digit before marking wrong — you may have misread a digit.
  • If the student's final answer is correct, award full marks even if working is incomplete
  • Be fair — partial credit where appropriate
  • Imagine a 100x100 grid over the page (0,0 = top-left)

⚠️ FINAL VERIFICATION (MANDATORY — do this BEFORE writing JSON):
  For EACH question, write out in your head:
    "Printed question: [X op Y]. My computation: [result]. Student wrote: [Z]. Match? [yes/no]"
  If your computed answer matches the student's answer → status MUST be "Correct", full marks.
  If you marked something "Incorrect" but the numbers match → you made an error. Fix it.
  NEVER mark a correct answer as wrong.

Return a JSON object with EXACTLY these keys:
${maxIsExplicit
    ? `- "total_marks": integer score out of ${maxTotalMarks}\n- "paper_max_marks": ${maxTotalMarks}`
    : `- "paper_max_marks": the TOTAL marks this paper is actually out of — count the questions and their mark allocations. Do NOT assume 10.\n- "total_marks": integer score out of paper_max_marks (never exceeding it)`}
- "confidence_score": 0-100 (OCR confidence + grading certainty combined)
- "report": One-sentence summary of the student's overall performance
- "corrections": Array of mistakes ONLY (do NOT include correct answers here), each with:
    { "text": "what student wrote", "correct_answer": "correct response", "x": 0-100, "y": 0-100 }
- "question_analysis": Array per question:
    { "q_num": "Q1", "status": "Correct|Partial|Incorrect", "marks_awarded": 2, "max_marks": ${maxIsExplicit ? 'the max marks for that question' : '1'}, "teacher_tip": "Printed: [question]. Correct answer: [X]. Student wrote: [Y]." }
  The teacher_tip MUST always show the printed question, your computed answer, and the student's answer so the teacher can verify.

Return ONLY raw JSON. No markdown.`;

                const contentArray = await buildOCRContentArray(allPagePaths, prompt);

                // Stage 1: Transcribe (all pages)
                let transcription = '', ocrConfidence = 0;
                try {
                    ({ transcription, ocrConfidence } = await transcribePaper(allPagePaths, gradeModel));
                    console.log(`[ReGrade] Transcribed ${transcription.length} chars from ${allPagePaths.length} page(s) for script ${scriptId}`);
                } catch (tErr) { console.warn('[ReGrade] Transcription failed:', tErr.message); }

                if (!isMaths && transcription) {
                    const hasMathOps = /[\+\-×÷]\s*\d|\d\s*[\+\-×÷]|\d+\s*[xX×]\s*\d|\b\d+\s*\+\s*\d+\b|\b\d+\s*-\s*\d+\b|\b\d+\s*÷\s*\d+\b/.test(transcription);
                    if (hasMathOps) { isMaths = true; contentArray[0].text += MATHS_GUIDANCE_TEXT_GLOBAL; }
                }
                if (transcription && transcription.length > 15) {
                    contentArray[0].text += `\n\n━━━ TRANSCRIPTION (verify numbers from IMAGE) ━━━\n${transcription}\n━━━ END ━━━`;
                }

                // Stage 2: Ensemble grade
                let aiData = await gradeWithEnsemble(contentArray, systemMsg, gradeModel);
                if (aiData) aiData._transcription = transcription;
                if (!aiData) {
                    db.run(`UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0, flags = 'Manual Review Needed', report = 'AI could not grade — please review manually.' WHERE id = ?`, [scriptId]);
                    return;
                }

                // Max marks
                if (!maxIsExplicit) {
                    const detectedMax = parseInt(aiData.paper_max_marks, 10);
                    if (!isNaN(detectedMax) && detectedMax > 0 && detectedMax <= 500) maxTotalMarks = detectedMax;
                }
                aiData.total_marks = Math.min(parseFloat(aiData.total_marks) || 0, maxTotalMarks);

                // Math verification — run for any paper with arithmetic
                if (Array.isArray(aiData.question_analysis)) {
                    const fixed = verifyArithmetic(transcription, aiData.question_analysis, maxTotalMarks, '[ReGrade MathVerify]');
                    if (fixed > 0) {
                        aiData.total_marks = Math.min(
                            aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0),
                            maxTotalMarks
                        );
                    }
                }

                // ── Blind-read verification for re-grade ─────────
                if (Array.isArray(aiData.question_analysis) &&
                    aiData.question_analysis.some(q => q.status === 'Correct')) {
                    try {
                        const blindAnswers = await blindReadAnswers(allPagePaths, gradeModel);
                        if (Object.keys(blindAnswers).length > 0) {
                            if (!aiData.corrections) aiData.corrections = [];
                            const flips = applyBlindVerification(
                                aiData.question_analysis, blindAnswers,
                                transcription, aiData.corrections, '[ReGrade BlindVerify]'
                            );
                            if (flips > 0) {
                                aiData.total_marks = Math.min(
                                    aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0),
                                    maxTotalMarks
                                );
                            }
                        }
                    } catch (bErr) { console.warn('[ReGrade BlindVerify] Error:', bErr.message); }
                }

                // ── Sanity checks ─────────────────────────────
                if (Array.isArray(aiData.question_analysis)) {
                    const marksPerQ = Math.round(maxTotalMarks / (aiData.question_analysis.length || 1));
                    for (const q of aiData.question_analysis) {
                        const m = parseFloat(q.marks_awarded) || 0;
                        if (m < 0) q.marks_awarded = 0;
                        if (m > marksPerQ) q.marks_awarded = marksPerQ;
                    }
                    const qaSum = aiData.question_analysis.reduce((s, qq) => s + (parseFloat(qq.marks_awarded) || 0), 0);
                    aiData.total_marks = Math.min(qaSum, maxTotalMarks);
                }
                if (aiData.total_marks < 0) aiData.total_marks = 0;
                if (aiData.total_marks > maxTotalMarks) aiData.total_marks = maxTotalMarks;

                const score = parseFloat(aiData.confidence_score) || 0;
                const correctionsStr = JSON.stringify(aiData.corrections || []);
                const cleanedQA = (aiData.question_analysis || []).map(({ _unanimous, ...rest }) => rest);
                const questionAnalysisStr = JSON.stringify(cleanedQA);

                db.get(`SELECT COALESCE(
                    (SELECT value FROM teacher_settings WHERE teacher_id = ? AND key = 'confidence_threshold'),
                    (SELECT value FROM settings WHERE key = 'confidence_threshold'), '75') AS value`,
                    [req.user.id], (err, row) => {
                    const threshold = row ? parseFloat(row.value) : 75;
                    const status = score < threshold ? 'Needs Review' : 'Evaluated';
                    const flags = score < threshold ? 'Low Confidence' : 'AI Verified';
                    db.run(`UPDATE scripts SET status = ?, total_marks = ?, max_marks = ?, confidence_score = ?, flags = ?, report = ?, corrections = ?, question_analysis = ?, ai_total_marks = ?, ai_confidence = ?, transcription = ? WHERE id = ?`,
                        [status, aiData.total_marks, maxTotalMarks, score, flags, aiData.report, correctionsStr, questionAnalysisStr, aiData.total_marks, score, transcription || null, scriptId]);
                });
                console.log(`[ReGrade] Completed for script ${scriptId}: ${aiData.total_marks}/${maxTotalMarks}`);
            } catch (err) {
                console.error('[ReGrade] Error:', err);
                db.run(`UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0, flags = 'AI Failed', report = ? WHERE id = ?`,
                    ['Re-grade failed: ' + err.message, scriptId]);
            }
        })();
    });
});

// ════════════════════════════════════════════════════════════════════════════
// STUDENT FEEDBACK & ANALYSIS — Generate improvement suggestions PDF
// ════════════════════════════════════════════════════════════════════════════

// Generate AI feedback for a reviewed script — analyze wrong answers & create improvement suggestions
app.post('/api/scripts/:id/feedback-pdf', verifyToken, async (req, res) => {
    try {
        // Teachers access by teacher_id; students access only their own scripts
        // (matched by their student code + their class's teacher).
        const isStudent = req.user.role === 'Student';
        const script = await new Promise((resolve, reject) => {
            const sql = isStudent
                ? `SELECT * FROM scripts WHERE id = ? AND student_id = ? AND teacher_id = ?`
                : `SELECT * FROM scripts WHERE id = ? AND teacher_id = ?`;
            const params = isStudent
                ? [req.params.id, req.user.student_code, req.user.teacher_id]
                : [req.params.id, req.user.id];
            db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        });

        if (!script) return res.status(404).json({ error: 'Script not found' });

        let questionAnalysis = [];
        try { questionAnalysis = JSON.parse(script.question_analysis || '[]'); }
        catch {}

        // Filter to only wrong/incorrect answers
        const wrongAnswers = questionAnalysis.filter(q => q.status === 'Incorrect' || q.marks_awarded === 0);

        if (wrongAnswers.length === 0) {
            return res.json({
                pdfUrl: null,
                message: 'No wrong answers — excellent work! ✓'
            });
        }

        // Prepare summary of mistakes for AI analysis
        const mistakeSummary = wrongAnswers.map(q =>
            `Q${q.q_num} (${q.max_marks}m): Student answer was "${q.student_answer}". ` +
            `Expected to cover: "${q.expected}". ` +
            `Topic: ${q.topic || 'General'}`
        ).join('\n');

        const feedbackPrompt = `You are an experienced ${script.grade} ${script.subject} teacher. A student took an exam and got some questions wrong.
Analyze their mistakes and provide personalized, encouraging feedback to help them improve in the future.

Student: ${script.student_id} | Grade: ${script.grade} | Subject: ${script.subject} | Exam: ${script.exam}
Total Score: ${script.total_marks}/${script.max_marks} (${Math.round((script.total_marks/script.max_marks)*100)}%)

QUESTIONS THEY GOT WRONG:
${mistakeSummary}

Return a JSON object with this exact structure:
{
  "overall_assessment": "2-3 sentences, encouraging but honest about their performance",
  "key_mistakes": [
    { "topic": "Topic name", "what_went_wrong": "What the student misunderstood", "why": "Why this mistake likely happened" }
  ],
  "improvement_plan": ["Specific actionable study step 1", "Step 2", "Step 3"],
  "topics_to_revise": ["Topic 1", "Topic 2"],
  "encouragement": "1-2 sentences of motivation and confidence boost"
}

Keep language simple, age-appropriate, and motivating. Focus on a growth mindset. Return ONLY raw JSON.`;

        const feedbackResp = await openai.chat.completions.create({
            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
            messages: [{ role: 'user', content: feedbackPrompt }],
            max_tokens: 1500,
            temperature: 0.7,
            response_format: { type: 'json_object' },
        });

        let feedback;
        try { feedback = JSON.parse(feedbackResp.choices[0].message.content); }
        catch { feedback = { overall_assessment: feedbackResp.choices[0].message.content, key_mistakes: [], improvement_plan: [], topics_to_revise: [], encouragement: '' }; }

        // Return structured feedback + the wrong-answer list. The frontend renders
        // this as a printable page (browser → Save as PDF), matching how the rest
        // of the app produces PDFs. No external PDF dependency needed.
        return res.json({
            student: {
                student_id: script.student_id,
                grade: script.grade,
                subject: script.subject,
                exam: script.exam,
                total_marks: script.total_marks,
                max_marks: script.max_marks,
                percentage: Math.round((script.total_marks / script.max_marks) * 100),
            },
            feedback,
            wrong_answers: wrongAnswers.map(q => ({
                q_num: q.q_num,
                max_marks: q.max_marks,
                topic: q.topic || 'General',
                student_answer: q.student_answer || '',
                teacher_tip: q.teacher_tip || '',
            })),
        });

    } catch (err) {
        console.error('[Feedback PDF] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Settings — per-teacher: each teacher gets their own confidence threshold.
// Falls back to the global default when a teacher hasn't customised a key.
app.get('/api/settings', verifyToken, (req, res) => {
    db.all(`SELECT key, value FROM teacher_settings WHERE teacher_id = ?`, [req.user.id], (err, teacherRows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        teacherRows.forEach(r => settings[r.key] = r.value);
        // Fill in global defaults for any keys the teacher hasn't overridden.
        db.all(`SELECT * FROM settings`, [], (err2, globalRows) => {
            if (!err2) globalRows.forEach(r => { if (!(r.key in settings)) settings[r.key] = r.value; });
            res.json(settings);
        });
    });
});

app.put('/api/settings', verifyToken, (req, res) => {
    const { confidence_threshold } = req.body;
    db.run(
        `INSERT INTO teacher_settings (teacher_id, key, value) VALUES (?, 'confidence_threshold', ?)
         ON CONFLICT(teacher_id, key) DO UPDATE SET value = excluded.value`,
        [req.user.id, confidence_threshold.toString()], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Settings updated' });
        });
});

// ── Classes management (teacher's classrooms) ───────────────────────────
app.get('/api/classes', verifyToken, (req, res) => {
    db.all(`SELECT * FROM classes WHERE teacher_id = ? ORDER BY created_at DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/classes', verifyToken, (req, res) => {
    const { name, grade, subject } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Class name required' });
    db.run(`INSERT INTO classes (teacher_id, name, grade, subject) VALUES (?, ?, ?, ?)`,
        [req.user.id, name.trim(), grade || '', subject || ''], function (err) {
            if (err) return res.status(err.message.match(/UNIQUE|duplicate key/i) ? 409 : 500).json({ error: err.message });
            res.json({ id: this.lastID, name, grade, subject });
        });
});

app.put('/api/classes/:id', verifyToken, (req, res) => {
    const { name, grade, subject } = req.body;
    db.run(`UPDATE classes SET name = ?, grade = ?, subject = ? WHERE id = ? AND teacher_id = ?`,
        [name || '', grade || '', subject || '', req.params.id, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Class not found' });
            res.json({ message: 'Class updated' });
        });
});

app.delete('/api/classes/:id', verifyToken, (req, res) => {
    db.run(`DELETE FROM classes WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Class removed' });
    });
});

// ── Students management (per-class roster) ──────────────────────────────
app.get('/api/classes/:id/students', verifyToken, (req, res) => {
    db.all(`SELECT s.* FROM students s JOIN classes c ON s.class_id = c.id
            WHERE c.id = ? AND c.teacher_id = ? ORDER BY s.created_at`,
        [req.params.id, req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
});

app.post('/api/classes/:id/students', verifyToken, async (req, res) => {
    const { student_id, name, email, username, password } = req.body;
    if (!student_id?.trim()) return res.status(400).json({ error: 'Student ID required' });

    // Verify this class belongs to the requesting teacher.
    const cls = await new Promise(r => db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], (e, row) => r(row)));
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    let hashedPw = null;
    const uname = username?.trim() || null;
    if (uname) {
        if (!password) return res.status(400).json({ error: 'Password required when username is set' });
        hashedPw = await bcrypt.hash(password, 10);
    }

    db.run(`INSERT INTO students (class_id, student_id, name, email, username, password) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.params.id, student_id.trim(), name || '', email || '', uname, hashedPw], function (err) {
            if (err) {
                const dup = err.message.match(/UNIQUE|duplicate key/i);
                const msg = dup && err.message.includes('username') ? 'That username is already taken' : err.message;
                return res.status(dup ? 409 : 500).json({ error: msg });
            }
            res.json({ id: this.lastID, student_id, name, email, username: uname, has_login: !!uname });
        });
});

// Set or update a student's login credentials (teacher action).
app.put('/api/students/:id/credentials', verifyToken, async (req, res) => {
    const { username, password } = req.body;
    if (!username?.trim()) return res.status(400).json({ error: 'Username required' });
    try {
        // Verify this student belongs to the requesting teacher.
        const student = await new Promise((resolve, reject) => {
            db.get(`SELECT s.id FROM students s JOIN classes c ON s.class_id = c.id
                    WHERE s.id = ? AND c.teacher_id = ?`, [req.params.id, req.user.id],
                (e, r) => e ? reject(e) : resolve(r));
        });
        if (!student) return res.status(404).json({ error: 'Student not found' });

        // Password is optional on update (keep existing if not provided).
        if (password) {
            const hashed = await bcrypt.hash(password, 10);
            db.run(`UPDATE students SET username = ?, password = ? WHERE id = ?`,
                [username.trim(), hashed, req.params.id], handle);
        } else {
            db.run(`UPDATE students SET username = ? WHERE id = ?`,
                [username.trim(), req.params.id], handle);
        }
        function handle(err) {
            if (err) {
                const dup = err.message.match(/UNIQUE|duplicate key/i);
                return res.status(dup ? 409 : 500).json({ error: dup ? 'That username is already taken' : err.message });
            }
            res.json({ ok: true, username: username.trim() });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/students/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM students WHERE id = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
        [req.params.id, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Student not found' });
            res.json({ message: 'Student removed' });
        });
});

// ════════════════════════════════════════════════════════════════════════════
// STUDENT PORTAL — endpoints a logged-in student uses to see their own data
// ════════════════════════════════════════════════════════════════════════════
const verifyStudent = (req, res, next) => {
    if (req.user?.role !== 'Student') return res.status(403).json({ error: 'Students only' });
    next();
};

// Student profile
app.get('/api/student/me', verifyToken, verifyStudent, (req, res) => {
    db.get(`SELECT s.id, s.student_id, s.name, s.email, s.username,
                   c.name AS class_name, c.grade, c.subject
            FROM students s JOIN classes c ON s.class_id = c.id
            WHERE s.id = ?`, [req.user.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Profile not found' });
        res.json(row);
    });
});

// Student's own graded results (scripts matched by their student code + their teacher)
app.get('/api/student/results', verifyToken, verifyStudent, (req, res) => {
    db.all(
        `SELECT id, subject, grade, exam, total_marks, max_marks, confidence_score,
                report, question_analysis, status, upload_timestamp
         FROM scripts
         WHERE student_id = ? AND teacher_id = ? AND is_deleted = 0
         ORDER BY upload_timestamp DESC`,
        [req.user.student_code, req.user.teacher_id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || [])
    );
});

// ── GAMIFICATION — XP, level, badges, class leaderboard ─────────────────────
// XP is derived from graded papers and quiz attempts (no extra tables needed).
async function computeGamification(studentRowId, studentCode, teacherId, classId) {
    const scripts = await new Promise(r => db.all(
        `SELECT total_marks, max_marks FROM scripts WHERE student_id = ? AND teacher_id = ? AND is_deleted = 0 AND total_marks IS NOT NULL`,
        [studentCode, teacherId], (e, rows) => r(rows || [])));
    const quizzes = await new Promise(r => db.all(
        `SELECT score, total FROM quiz_attempts WHERE student_id = ?`, [studentRowId], (e, rows) => r(rows || [])));
    const live = await new Promise(r => db.get(
        `SELECT COALESCE(SUM(score),0) AS pts, COUNT(*) AS games FROM live_scores WHERE student_id = ?`,
        [studentRowId], (e, row) => r(row || { pts: 0, games: 0 })));

    let xp = 0;
    // Live quiz points feed XP at a reduced rate (they're large Kahoot-style numbers).
    xp += Math.round((live.pts || 0) / 50);
    const scriptPcts = scripts.map(s => s.max_marks ? (s.total_marks / s.max_marks) * 100 : 0);
    const quizPcts   = quizzes.map(q => q.total ? (q.score / q.total) * 100 : 0);
    // 10 XP per paper + bonus for high scores; 8 XP per quiz + bonus.
    scriptPcts.forEach(p => { xp += 10 + Math.round(p / 10) + (p >= 90 ? 15 : 0); });
    quizPcts.forEach(p => { xp += 8 + Math.round(p / 10) + (p === 100 ? 20 : 0); });

    const allPcts = [...scriptPcts, ...quizPcts];
    const avg = allPcts.length ? allPcts.reduce((a, b) => a + b, 0) / allPcts.length : 0;
    const level = Math.floor(xp / 100) + 1;
    const xpInLevel = xp % 100;

    const badges = [];
    const add = (id, icon, name, earned) => badges.push({ id, icon, name, earned });
    add('first_steps', '🎯', 'First Steps', allPcts.length >= 1);
    add('quiz_taker',  '✏️', 'Quiz Taker', quizzes.length >= 1);
    add('quiz_master', '🏆', 'Quiz Master', quizzes.length >= 5);
    add('perfect',     '💯', 'Perfect Score', quizPcts.some(p => p === 100) || scriptPcts.some(p => p >= 100));
    add('high_flyer',  '🚀', 'High Flyer', avg >= 80 && allPcts.length >= 3);
    add('dedicated',   '🔥', 'Dedicated', allPcts.length >= 10);
    add('scholar',     '🎓', 'Scholar', level >= 5);
    add('live_legend', '⚡', 'Live Legend', (live.games || 0) >= 3);

    return {
        xp, level, xpInLevel, xpToNext: 100, avg: Math.round(avg),
        papers: scripts.length, quizzes: quizzes.length,
        livePoints: live.pts || 0, liveGames: live.games || 0, badges,
    };
}

app.get('/api/student/gamification', verifyToken, verifyStudent, async (req, res) => {
    try {
        const stu = await new Promise(r => db.get('SELECT class_id FROM students WHERE id = ?', [req.user.id], (e, row) => r(row)));
        const g = await computeGamification(req.user.id, req.user.student_code, req.user.teacher_id, stu?.class_id);
        res.json(g);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Class leaderboard (by XP) — visible to students in the same class.
app.get('/api/student/leaderboard', verifyToken, verifyStudent, async (req, res) => {
    try {
        const stu = await new Promise(r => db.get('SELECT class_id FROM students WHERE id = ?', [req.user.id], (e, row) => r(row)));
        const classmates = await new Promise(r => db.all(
            'SELECT id, student_id, name FROM students WHERE class_id = ?', [stu?.class_id], (e, rows) => r(rows || [])));
        const board = [];
        for (const c of classmates) {
            const g = await computeGamification(c.id, c.student_id, req.user.teacher_id, stu?.class_id);
            board.push({ name: c.name || c.student_id, xp: g.xp, level: g.level, isMe: c.id === req.user.id });
        }
        board.sort((a, b) => b.xp - a.xp);
        res.json(board.slice(0, 20).map((b, i) => ({ ...b, rank: i + 1 })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Student's own attendance summary
app.get('/api/student/attendance', verifyToken, verifyStudent, (req, res) => {
    db.all(
        `SELECT date, status, note FROM attendance
         WHERE student_id = ? ORDER BY date DESC LIMIT 90`,
        [req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || [])
    );
});

// ── Exams management (per-class assessments) ────────────────────────────
app.get('/api/classes/:id/exams', verifyToken, (req, res) => {
    db.all(`SELECT e.* FROM exams e JOIN classes c ON e.class_id = c.id
            WHERE c.id = ? AND c.teacher_id = ? ORDER BY e.exam_date DESC`,
        [req.params.id, req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
});

app.post('/api/classes/:id/exams', verifyToken, (req, res) => {
    const { title, description, exam_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Exam title required' });
    // Verify class belongs to this teacher before creating an exam in it.
    db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], (err, cls) => {
        if (err || !cls) return res.status(404).json({ error: 'Class not found' });
        db.run(`INSERT INTO exams (class_id, title, description, exam_date) VALUES (?, ?, ?, ?)`,
            [req.params.id, title.trim(), description || '', exam_date || null], function (err2) {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ id: this.lastID, title, description, exam_date });
            });
    });
});

app.delete('/api/exams/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM exams WHERE id = ? AND class_id IN (SELECT id FROM classes WHERE teacher_id = ?)`,
        [req.params.id, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Exam not found' });
            res.json({ message: 'Exam removed' });
        });
});

// ── Subject Curriculum Contexts ─────────────────────────────────────────────
// Teachers upload a notebook/syllabus for a specific grade+subject.
// We OCR it, extract structured topics + content, and store it.
// When a student script is graded, we look up a matching context and inject
// it into the prompt so the AI marks against the teacher's own curriculum.

// Extract structured curriculum from raw OCR text using a second GPT-4o call
async function extractCurriculumFromText(rawText, grade, subject, language = 'English') {
    const langNote = language !== 'English'
        ? `
⚠️ LANGUAGE RULES (strictly follow):
- The textbook is written in ${language} mixed with English technical terms.
- PRESERVE the original language of each word — do NOT translate anything:
  • ${language} words → keep in ${language}
  • English words (e.g. "Input Device", "Printer", "Monitor", "Software") → keep in English exactly as written
- Sri Lankan ${subject} textbooks use Sinhala sentences but English for technical/subject terms. Respect this exactly.
- If the raw text has OCR artifacts or garbled characters (e.g. "ප‍2dරිං" instead of "ප්‍රිංටර්"), use your knowledge to reconstruct the correct original word in its original language — never translate it.`
        : '';

    const prompt = `You are an expert curriculum analyst.
The following is raw text extracted from a ${grade} ${subject} textbook or notebook.${langNote}

YOUR TASK:
1. Identify all major topics / chapters covered
2. For each topic, list the key learning outcomes and expected knowledge
3. Extract any specific facts, formulas, definitions, or rules students must know
4. Note the marking-relevant terms and concepts
5. Fix OCR noise — reconstruct correct words in their original language, never translate

OUTPUT FORMAT (JSON):
{
  "topics": [
    {
      "name": "Topic name",
      "outcomes": ["Students can...", "Students know..."],
      "key_facts": ["Fact 1", "Fact 2"],
      "keywords": ["word1", "word2"]
    }
  ],
  "summary": "2-3 sentence overview of the full curriculum",
  "grading_guidance": "How to assess ${grade} ${subject} answers — what to look for, common mistakes"
}

RAW TEXT:
${rawText.slice(0, 12000)}`;

    const response = await openai.chat.completions.create({
        model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 3000,
        response_format: { type: 'json_object' },
    });

    let text = response.choices[0].message.content || '{}';
    text = text.trim().replace(/^```json?\n?/, '').replace(/```$/, '').trim();
    try { return JSON.parse(text); }
    catch { return { topics: [], summary: rawText.slice(0, 500), grading_guidance: '' }; }
}

// List all curriculum contexts for the authenticated teacher
app.get('/api/subject-context', verifyToken, (req, res) => {
    db.all(
        `SELECT id, grade, subject, label, filename, topics, created_at
         FROM subject_contexts WHERE teacher_id = ? ORDER BY grade, subject`,
        [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows.map(r => ({
                ...r,
                topics: (() => { try { return JSON.parse(r.topics); } catch { return []; } })()
            })));
        }
    );
});

// ── Textbook processing job store (in-memory, per-process) ──────────────────
// Each upload gets a unique jobId. The frontend polls /api/subject-context/job/:id
// for live progress updates via Server-Sent Events.
const textbookJobs = new Map();  // jobId → { status, progress[], error, result }

function createJob() {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    textbookJobs.set(id, { status: 'running', progress: [], error: null, result: null });
    return id;
}

function pushProgress(jobId, message, pct = null) {
    const job = textbookJobs.get(jobId);
    if (!job) return;
    const entry = { message, pct, ts: Date.now() };
    job.progress.push(entry);
    console.log(`[Textbook ${jobId}] ${message}`);
}

function finishJob(jobId, result) {
    const job = textbookJobs.get(jobId);
    if (!job) return;
    job.status = 'done';
    job.result = result;
}

function failJob(jobId, error) {
    const job = textbookJobs.get(jobId);
    if (!job) return;
    job.status = 'error';
    job.error = error;
}

// SSE progress stream — frontend connects once, receives all progress events
app.get('/api/subject-context/progress/:jobId', verifyToken, (req, res) => {
    const { jobId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let lastSent = -1;

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const interval = setInterval(() => {
        const job = textbookJobs.get(jobId);
        if (!job) { send({ type: 'error', message: 'Job not found' }); clearInterval(interval); res.end(); return; }

        // Send any new progress messages
        for (let i = lastSent + 1; i < job.progress.length; i++) {
            send({ type: 'progress', ...job.progress[i] });
            lastSent = i;
        }

        if (job.status === 'done') {
            send({ type: 'done', result: job.result });
            clearInterval(interval);
            res.end();
            // Clean up after 5 minutes
            setTimeout(() => textbookJobs.delete(jobId), 5 * 60 * 1000);
        } else if (job.status === 'error') {
            send({ type: 'error', message: job.error });
            clearInterval(interval);
            res.end();
            setTimeout(() => textbookJobs.delete(jobId), 60 * 1000);
        }
    }, 400);

    req.on('close', () => clearInterval(interval));
});

// Upload a notebook/syllabus → extract text → curriculum analysis → store
//
// Strategy for large PDFs (e.g. 22 MB, 100+ page official textbooks):
//   1. pdf-parse   — extracts ALL embedded text instantly (100% of digital PDFs)
//   2. If text > 60 000 chars: split into 2–3 large chunks, analyse in parallel
//   3. Visual OCR  — fallback only for scanned/handwritten documents
//   4. Returns a jobId immediately; progress streamed via SSE
//
app.post('/api/subject-context', verifyToken, async (req, res) => {
    try {
        const { fields, file } = await parseUpload(req);
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        const { grade, subject, label, language } = fields;
        if (!grade?.trim() || !subject?.trim())
            return res.status(400).json({ error: 'grade and subject are required' });

        const gradeClean    = grade.trim();
        const subjectClean  = subject.trim();
        const languageClean = (language || 'English').trim();
        const ext          = path.extname(file.path).toLowerCase();
        const fileSizeMB   = (fs.statSync(file.path).size / 1024 / 1024).toFixed(1);

        // Return the jobId immediately — processing continues in background
        const jobId = createJob();
        res.json({ jobId });

        // ── Background processing ────────────────────────────────────────────
        (async () => {
            try {
                pushProgress(jobId, `📄 Received "${file.originalname}" (${fileSizeMB} MB)`, 5);

                // ── STEP 1: Extract text ────────────────────────────────────
                let rawText = '';
                let method  = 'unknown';
                let numPages = 0;

                if (ext === '.pdf') {
                    pushProgress(jobId, '📖 Reading PDF text (all pages)…', 15);
                    try {
                        const buf  = fs.readFileSync(file.path);
                        const data = await pdfParse(buf);
                        numPages   = data.numpages || 0;
                        if (data.text && data.text.trim().length > 200) {
                            rawText = data.text.trim();
                            method  = `pdf-parse`;
                            pushProgress(jobId, `✅ Extracted text from all ${numPages} pages (${rawText.length.toLocaleString()} characters)`, 35);
                        }
                    } catch (pdfErr) {
                        pushProgress(jobId, `⚠️ pdf-parse failed: ${pdfErr.message}`, 20);
                    }

                    // Scanned PDF fallback — visual OCR page by page
                    if (!rawText) {
                        pushProgress(jobId, '🔍 PDF has no embedded text — running visual OCR…', 20);
                        try {
                            const outDir = path.join(path.dirname(file.path), `tbctx_${Date.now()}`);
                            fs.mkdirSync(outDir, { recursive: true });
                            const converter = fromPath(file.path, {
                                density: 150, saveFilename: 'pg', savePath: outDir,
                                format: 'jpeg', width: 1800, height: 1800,
                            });
                            const MAX_VISUAL_PAGES = 40;
                            const pageTexts = [];
                            for (let pg = 1; pg <= MAX_VISUAL_PAGES; pg++) {
                                try {
                                    const result = await converter(pg);
                                    if (!result?.path || !fs.existsSync(result.path)) break;
                                    const enhanced = await preprocessImageForOCR(result.path);
                                    const b64 = encodeImage(enhanced);
                                    const ocrLang = languageClean !== 'English'
                                        ? `Extract ALL text from this page exactly as written. This is a ${languageClean} textbook that mixes ${languageClean} script with English technical terms. Rules:\n- Output ${languageClean} words in clean correct ${languageClean} Unicode\n- Output English words (e.g. "Input Device", "Printer", "Software") in English exactly as printed\n- Do NOT translate anything — keep each word in its original language\n- Do NOT add garbled characters or OCR artifacts`
                                        : 'Extract ALL text from this page verbatim.';
                                    const ocrRes = await openai.chat.completions.create({
                                        model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
                                        messages: [{ role: 'user', content: [
                                            { type: 'text', text: ocrLang },
                                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } }
                                        ]}],
                                        max_tokens: 2000,
                                    });
                                    pageTexts.push(ocrRes.choices[0].message.content || '');
                                    if (enhanced !== result.path) try { fs.unlinkSync(enhanced); } catch {}
                                    fs.unlinkSync(result.path);
                                    if (pg % 5 === 0) pushProgress(jobId, `🔍 OCR: page ${pg} done…`, 20 + Math.round(pg / MAX_VISUAL_PAGES * 15));
                                } catch { break; }
                            }
                            try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
                            rawText  = pageTexts.join('\n\n---PAGE---\n\n');
                            numPages = pageTexts.length;
                            method   = `visual-ocr`;
                            pushProgress(jobId, `✅ Visual OCR complete — ${numPages} pages, ${rawText.length.toLocaleString()} chars`, 35);
                        } catch (ocrErr) {
                            pushProgress(jobId, `❌ Visual OCR failed: ${ocrErr.message}`, 35);
                        }
                    }
                } else {
                    // Image file
                    pushProgress(jobId, '🔍 Reading image…', 20);
                    try {
                        const enhanced = await preprocessImageForOCR(file.path);
                        const b64      = encodeImage(enhanced);
                        const mimeType = getMimeType(file.path);
                        const imgOcrPrompt = languageClean !== 'English'
                            ? `Extract ALL text from this ${gradeClean} ${subjectClean} document exactly as written. This document mixes ${languageClean} with English technical terms. Rules:\n- Output ${languageClean} words in clean correct ${languageClean} Unicode\n- Output English words (e.g. "Input Device", "Printer", "Software") in English exactly as printed\n- Do NOT translate anything — keep each word in its original language\n- Do NOT add garbled characters or artifacts`
                            : `Extract ALL text from this ${gradeClean} ${subjectClean} document verbatim.`;
                        const ocrRes   = await openai.chat.completions.create({
                            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
                            messages: [{ role: 'user', content: [
                                { type: 'text', text: imgOcrPrompt },
                                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } }
                            ]}],
                            max_tokens: 4000,
                        });
                        rawText = ocrRes.choices[0].message.content || '';
                        method  = 'image-ocr';
                        numPages = 1;
                        if (enhanced !== file.path) try { fs.unlinkSync(enhanced); } catch {}
                        pushProgress(jobId, `✅ Image OCR complete — ${rawText.length.toLocaleString()} chars`, 35);
                    } catch (imgErr) {
                        pushProgress(jobId, `❌ Image OCR failed: ${imgErr.message}`, 35);
                    }
                }

                if (!rawText || rawText.trim().length < 50) {
                    return failJob(jobId, 'Could not extract text from this file. For scanned PDFs please ensure the scan is clear.');
                }

                // ── STEP 2: AI curriculum analysis ──────────────────────────
                // GPT-4o supports ~128K tokens. A 100-page textbook = ~40 000 words
                // = ~55 000 tokens — fits in a single call.
                // We only chunk when text is truly huge (> 80 000 chars ≈ 60K tokens).
                const CHUNK_SIZE = 80000;
                let curriculum = { topics: [], summary: '', grading_guidance: '' };

                if (rawText.length <= CHUNK_SIZE) {
                    pushProgress(jobId, `🧠 Analysing full curriculum (${rawText.length.toLocaleString()} chars in one pass)…`, 50);
                    curriculum = await extractCurriculumFromText(rawText, gradeClean, subjectClean, languageClean);
                    pushProgress(jobId, `✅ Found ${curriculum.topics?.length || 0} topics`, 80);
                } else {
                    // Build non-overlapping chunks of 80 000 chars
                    const chunks = [];
                    for (let i = 0; i < rawText.length; i += CHUNK_SIZE) {
                        chunks.push(rawText.slice(i, i + CHUNK_SIZE));
                    }
                    pushProgress(jobId, `🧠 Large textbook — analysing ${chunks.length} parts in parallel…`, 50);

                    const settled = await Promise.allSettled(
                        chunks.map((chunk, ci) => {
                            pushProgress(jobId, `  ↳ Part ${ci + 1}/${chunks.length} sent to AI…`, 50 + Math.round((ci / chunks.length) * 25));
                            return extractCurriculumFromText(chunk, gradeClean, subjectClean, languageClean);
                        })
                    );

                    // Merge — deduplicate by topic name
                    const topicMap = {};
                    for (const r of settled) {
                        if (r.status !== 'fulfilled') continue;
                        for (const t of (r.value.topics || [])) {
                            const key = t.name?.toLowerCase().trim() || '';
                            if (!key) continue;
                            if (!topicMap[key]) {
                                topicMap[key] = { ...t };
                            } else {
                                topicMap[key].outcomes  = [...new Set([...(topicMap[key].outcomes || []), ...(t.outcomes || [])])];
                                topicMap[key].key_facts = [...new Set([...(topicMap[key].key_facts || []), ...(t.key_facts || [])])];
                                topicMap[key].keywords  = [...new Set([...(topicMap[key].keywords || []), ...(t.keywords || [])])];
                            }
                        }
                        if (!curriculum.summary && r.value.summary) curriculum.summary = r.value.summary;
                        if (!curriculum.grading_guidance && r.value.grading_guidance) curriculum.grading_guidance = r.value.grading_guidance;
                    }
                    curriculum.topics = Object.values(topicMap);
                    pushProgress(jobId, `✅ Merged ${curriculum.topics.length} unique topics from ${chunks.length} parts`, 80);
                }

                // ── STEP 3: Save to database ────────────────────────────────
                pushProgress(jobId, '💾 Saving to database…', 90);
                const topicsJson  = JSON.stringify(curriculum.topics || []);
                const fullContent = JSON.stringify({
                    raw: rawText.slice(0, 80000),
                    method, numPages,
                    ...curriculum,
                });

                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO subject_contexts (teacher_id, grade, subject, label, filename, content, topics)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [req.user.id, gradeClean, subjectClean,
                         (label || `${gradeClean} ${subjectClean}`).trim(),
                         file.originalname, fullContent, topicsJson],
                        function (err) {
                            if (err) return reject(err);
                            pushProgress(jobId, `✅ Curriculum saved! ${curriculum.topics?.length || 0} topics from ${numPages} pages`, 100);
                            finishJob(jobId, {
                                id:       this.lastID,
                                grade:    gradeClean,
                                subject:  subjectClean,
                                label:    (label || `${gradeClean} ${subjectClean}`).trim(),
                                filename: file.originalname,
                                topics:   curriculum.topics || [],
                                summary:  curriculum.summary,
                                grading_guidance: curriculum.grading_guidance,
                                chars_extracted:  rawText.length,
                                num_pages:        numPages,
                                method,
                                message: `Curriculum saved — ${curriculum.topics?.length || 0} topics from ${numPages} pages (${rawText.length.toLocaleString()} chars)`,
                            });
                            resolve();
                        }
                    );
                });

            } catch (err) {
                console.error('[Context] Background error:', err);
                failJob(jobId, err.message || 'Processing failed');
            }
        })();

    } catch (err) {
        console.error('[Context] Upload error:', err);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
});

// Delete a curriculum context
app.delete('/api/subject-context/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM subject_contexts WHERE id = ? AND teacher_id = ?`,
        [req.params.id, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
            res.json({ message: 'Curriculum context deleted' });
        }
    );
});

// Get full content of a specific context (for preview)
app.get('/api/subject-context/:id', verifyToken, (req, res) => {
    db.get(
        `SELECT * FROM subject_contexts WHERE id = ? AND teacher_id = ?`,
        [req.params.id, req.user.id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Not found' });
            let content = {};
            try { content = JSON.parse(row.content); } catch {}
            res.json({ ...row, content });
        }
    );
});

// ═══════════════════════════════════════════════════════════════════════════
// PAPER GENERATOR — create exam papers from uploaded textbook knowledge
// ═══════════════════════════════════════════════════════════════════════════

// Generate a full exam paper using the textbook content as source material.
// config = { title, time, sections: [{ type, count, marks, difficulty }], topics[] }
app.post('/api/papers/generate', verifyToken, async (req, res) => {
    try {
        const { context_id, config } = req.body;
        if (!context_id) return res.status(400).json({ error: 'context_id required' });

        // Load textbook content
        const ctx = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM subject_contexts WHERE id = ? AND teacher_id = ?`,
                [context_id, req.user.id],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });
        if (!ctx) return res.status(404).json({ error: 'Textbook not found' });

        let parsed = {};
        try { parsed = JSON.parse(ctx.content); } catch {}

        // Build a rich source string: topics + raw text
        const topicSummary = (parsed.topics || []).map(t =>
            `Topic: ${t.name}\n` +
            (t.outcomes?.length  ? `  Outcomes: ${t.outcomes.join('; ')}\n`  : '') +
            (t.key_facts?.length ? `  Key facts: ${t.key_facts.join('; ')}\n` : '') +
            (t.keywords?.length  ? `  Keywords: ${t.keywords.join(', ')}\n`   : '')
        ).join('\n');

        const rawSnippet = parsed.raw ? `\n\nFULL TEXTBOOK TEXT:\n${parsed.raw.slice(0, 20000)}` : '';

        // Build section specs string
        const sectionSpecs = (config.sections || []).map((s, i) =>
            `Section ${i + 1}: ${s.count} × ${s.type} questions, ${s.marks} mark(s) each, difficulty: ${s.difficulty}`
        ).join('\n');

        const topicFilter = config.topics?.length
            ? `Only use these topics: ${config.topics.join(', ')}`
            : 'Use all topics in the textbook';

        const language = config.language || 'English';
        const langInstruction = language !== 'English'
            ? `
⚠️ LANGUAGE RULES — strictly follow these:
- Write questions and sentences in ${language}.
- Keep English technical terms in English exactly as in the textbook (e.g. "Input Device", "Printer", "Monitor", "Hardware", "Software", "Computer"). Do NOT translate them to ${language}.
- Do NOT translate ${language} words to English either.
- Sri Lankan school textbooks mix ${language} sentences with English technical terms — write questions the same way students learned them.
- The textbook source may have OCR artifacts. Use your subject knowledge — never copy garbled text into questions.`
            : '';

        const prompt = `You are an expert ${ctx.grade} ${ctx.subject} teacher. Create a complete exam paper using ONLY the knowledge from the textbook below.${langInstruction}

PAPER REQUIREMENTS:
- Title: ${config.title || `${ctx.grade} ${ctx.subject} Examination`}
- Grade: ${ctx.grade}
- Subject: ${ctx.subject}
- Language: ${language}
- Time allowed: ${config.time || '1 hour'}
- ${topicFilter}
- Difficulty mix: ${config.difficulty || 'Mixed (Easy 30%, Medium 50%, Hard 20%)'}

SECTIONS TO GENERATE:
${sectionSpecs}

QUESTION TYPE RULES:
- MCQ: provide exactly 4 options (A, B, C, D). Only one correct. Options must be plausible.
- true_false: statement is clearly true or false based on the textbook.
- short: expected answer is 1-3 sentences, key points only.
- essay: requires a paragraph response, 5-10 marks.
- fill: one blank per question, exact word from the textbook fills it.

STRICT RULE: Every question and its correct answer MUST be based on content explicitly found in this textbook. Do not invent facts.

━━━ TEXTBOOK CONTENT ━━━
${ctx.label || `${ctx.grade} ${ctx.subject}`}
${parsed.summary || ''}

TOPICS:
${topicSummary}
${rawSnippet}
━━━ END TEXTBOOK ━━━

OUTPUT: Return a JSON object with this exact structure:
{
  "title": "...",
  "grade": "...",
  "subject": "...",
  "time": "...",
  "instructions": "General instructions for students",
  "total_marks": <integer>,
  "sections": [
    {
      "id": "A",
      "title": "Section A — ...",
      "type": "mcq|true_false|short|essay|fill",
      "instructions": "...",
      "marks_per_q": <integer>,
      "questions": [
        {
          "num": 1,
          "text": "Question text",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],  // MCQ only
          "blank_hint": "_ _ _ _ _",  // fill only
          "marks": <integer>,
          "answer": "correct answer",
          "topic": "topic name this question is from"
        }
      ]
    }
  ]
}

Return ONLY raw JSON. No markdown.`;

        const gradeModel = process.env.FINE_TUNED_MODEL_ID || 'gpt-4o';
        const response = await openai.chat.completions.create({
            model: gradeModel,
            messages: [
                {
                    role: 'system',
                    content: language !== 'English'
                        ? `You are an expert ${ctx.grade} ${ctx.subject} teacher in Sri Lanka. You write high-quality exam papers that naturally mix ${language} sentences with English technical/subject terms — exactly how students studied the material. Strict rules: (1) Write sentences and explanations in ${language}. (2) Keep English subject terms in English — never translate "Input Device", "Printer", "Hardware", "Software", "Monitor", "Keyboard", "Computer", "Internet", "Network" or any other English term into ${language}. (3) Never translate ${language} words into English. (4) Ignore any OCR artifacts in the source text — write clean, correct content from your own subject knowledge.`
                        : `You are an expert ${ctx.grade} ${ctx.subject} teacher. You create high-quality, well-structured exam papers.`
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 8000,
            temperature: 0.3,
            response_format: { type: 'json_object' },
        });

        let paperText = response.choices[0].message.content || '{}';
        paperText = paperText.trim().replace(/^```json?\n?/, '').replace(/```$/, '').trim();

        let paper;
        try { paper = JSON.parse(paperText); }
        catch { return res.status(500).json({ error: 'AI returned invalid JSON. Please try again.' }); }

        // Extract answer key separately
        const answerKey = {};
        for (const section of (paper.sections || [])) {
            for (const q of (section.questions || [])) {
                answerKey[`${section.id}-${q.num}`] = {
                    answer: q.answer,
                    topic: q.topic,
                    marks: q.marks,
                };
                // Remove answer from student-facing paper
                delete q.answer;
            }
        }

        // Save to database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO generated_papers (teacher_id, context_id, title, grade, subject, config, paper, answer_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, context_id,
                 paper.title || config.title || `${ctx.grade} ${ctx.subject} Paper`,
                 ctx.grade, ctx.subject,
                 JSON.stringify(config),
                 JSON.stringify(paper),
                 JSON.stringify(answerKey)],
                function(err) {
                    if (err) return reject(err);
                    paper.id = this.lastID;
                    paper.answer_key = answerKey;
                    resolve();
                }
            );
        });

        res.json({ paper, answer_key: answerKey, id: paper.id });

    } catch (err) {
        console.error('[PaperGen] Error:', err);
        res.status(500).json({ error: 'Paper generation failed: ' + err.message });
    }
});

// List all papers for this teacher
app.get('/api/papers', verifyToken, (req, res) => {
    db.all(
        `SELECT id, title, grade, subject, created_at FROM generated_papers
         WHERE teacher_id = ? ORDER BY created_at DESC`,
        [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// Get a single paper with answer key
app.get('/api/papers/:id', verifyToken, (req, res) => {
    db.get(
        `SELECT * FROM generated_papers WHERE id = ? AND teacher_id = ?`,
        [req.params.id, req.user.id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Not found' });
            res.json({
                ...row,
                paper: (() => { try { return JSON.parse(row.paper); } catch { return {}; } })(),
                answer_key: (() => { try { return JSON.parse(row.answer_key); } catch { return {}; } })(),
                config: (() => { try { return JSON.parse(row.config); } catch { return {}; } })(),
            });
        }
    );
});

// Delete a paper
app.delete('/api/papers/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM generated_papers WHERE id = ? AND teacher_id = ?`,
        [req.params.id, req.user.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Paper deleted' });
        }
    );
});

// ── Fine-tuning data export ──────────────────────────────────────────────────
// Export all teacher-reviewed scripts as JSONL ready for OpenAI fine-tuning
app.get('/api/fine-tuning/export', verifyToken, (req, res) => {
    db.all(
        `SELECT s.student_id, s.subject, s.grade, s.exam, s.max_marks,
                s.total_marks, s.confidence_score, s.report, s.question_analysis,
                s.ai_total_marks, s.ai_confidence
         FROM scripts s
         WHERE s.teacher_id = ? AND s.reviewed_at IS NOT NULL AND s.is_deleted = 0
         ORDER BY s.reviewed_at DESC`,
        [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length === 0) return res.status(404).json({ error: 'No reviewed scripts found. Review AI-graded scripts first.' });

            const systemPrompt = `You are an expert educational grader. Grade student answer scripts fairly and accurately.
Output MUST be valid JSON with: total_marks, confidence_score, feedback, question_analysis.`;

            const lines = rows.map(r => {
                let qa = [];
                try { qa = JSON.parse(r.question_analysis || '[]'); } catch {}
                const example = {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        {
                            role: 'user',
                            content: `Grade this student answer:\nSubject: ${r.subject}\nGrade Level: ${r.grade}\nExam: ${r.exam}\nMax Marks: ${r.max_marks}\n\n[Student answer script — see uploaded image]`
                        },
                        {
                            role: 'assistant',
                            content: JSON.stringify({
                                total_marks: r.total_marks,
                                confidence_score: r.confidence_score,
                                feedback: r.report,
                                question_analysis: qa
                            })
                        }
                    ]
                };
                return JSON.stringify(example);
            });

            res.setHeader('Content-Type', 'application/x-ndjson');
            res.setHeader('Content-Disposition', `attachment; filename="marknex_finetune_${Date.now()}.jsonl"`);
            res.send(lines.join('\n'));
        }
    );
});

// ── Teacher-managed dropdown options (Grade / Subject / Exam) ────────────
const OPTION_TYPES = ['grade', 'subject', 'exam'];
const DEFAULT_OPTIONS = {
    grade: ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
    subject: ['Mathematics', 'Science', 'English', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology', 'ICT'],
    exam: ['Term 1', 'Term 2', 'Term 3', 'Mid-Term', 'Final'],
};

// Group flat rows into { grades, subjects, exams } of { id, value }.
function groupOptions(rows) {
    const out = { grades: [], subjects: [], exams: [] };
    const bucket = { grade: out.grades, subject: out.subjects, exam: out.exams };
    rows.forEach(r => bucket[r.type] && bucket[r.type].push({ id: r.id, value: r.value }));
    return out;
}

app.get('/api/options', verifyToken, (req, res) => {
    const tid = req.user.id;
    const query = (cb) => db.all(
        `SELECT id, type, value FROM options WHERE teacher_id = ? ORDER BY type, sort_order, id`,
        [tid], cb
    );
    query((err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length > 0) return res.json(groupOptions(rows));
        // First visit for this teacher: seed the defaults, then return them.
        const stmt = db.prepare(`INSERT INTO options (teacher_id, type, value, sort_order) VALUES (?, ?, ?, ?)`);
        OPTION_TYPES.forEach(type => DEFAULT_OPTIONS[type].forEach((value, i) => stmt.run(tid, type, value, i)));
        stmt.finalize(() => query((e2, rows2) => {
            if (e2) return res.status(500).json({ error: e2.message });
            res.json(groupOptions(rows2));
        }));
    });
});

app.post('/api/options', verifyToken, (req, res) => {
    const { type, value } = req.body;
    const v = (value || '').trim();
    if (!OPTION_TYPES.includes(type) || !v) return res.status(400).json({ error: 'Provide a valid type and value' });
    db.get(`SELECT MAX(sort_order) AS m FROM options WHERE teacher_id = ? AND type = ?`, [req.user.id, type], (err, row) => {
        const next = (row && row.m != null ? row.m : -1) + 1;
        db.run(`INSERT INTO options (teacher_id, type, value, sort_order) VALUES (?, ?, ?, ?)`,
            [req.user.id, type, v, next], function (e) {
                if (e) return res.status(e.message.match(/UNIQUE|duplicate key/i) ? 409 : 500).json({ error: e.message.match(/UNIQUE|duplicate key/i) ? 'That value already exists' : e.message });
                res.json({ id: this.lastID, type, value: v });
            });
    });
});

app.put('/api/options/:id', verifyToken, (req, res) => {
    const v = (req.body.value || '').trim();
    if (!v) return res.status(400).json({ error: 'Value cannot be empty' });
    db.run(`UPDATE options SET value = ? WHERE id = ? AND teacher_id = ?`, [v, req.params.id, req.user.id], function (e) {
        if (e) return res.status(e.message.match(/UNIQUE|duplicate key/i) ? 409 : 500).json({ error: e.message.match(/UNIQUE|duplicate key/i) ? 'That value already exists' : e.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Option not found' });
        res.json({ message: 'Option updated' });
    });
});

app.delete('/api/options/:id', verifyToken, (req, res) => {
    db.run(`DELETE FROM options WHERE id = ? AND teacher_id = ?`, [req.params.id, req.user.id], function (e) {
        if (e) return res.status(500).json({ error: e.message });
        res.json({ message: 'Option removed' });
    });
});

// ── Human-vs-AI agreement analytics ─────────────────────────────────────
// Measures how well the AI's original grade matched the teacher's final grade
// across every reviewed script. Returns accuracy, error and Quadratic Weighted
// Kappa (a standard inter-rater agreement metric) plus the raw pairs for a
// scatter plot. This is the core validation/research surface.

// Quadratic Weighted Kappa over integer category labels 0..K.
function quadraticWeightedKappa(aiCats, humanCats, K) {
    const n = aiCats.length;
    if (n === 0 || K <= 0) return null;
    const O = Array.from({ length: K + 1 }, () => new Array(K + 1).fill(0));
    const aiHist = new Array(K + 1).fill(0);
    const huHist = new Array(K + 1).fill(0);
    for (let i = 0; i < n; i++) {
        O[aiCats[i]][humanCats[i]]++;
        aiHist[aiCats[i]]++;
        huHist[humanCats[i]]++;
    }
    let num = 0, den = 0;
    for (let a = 0; a <= K; a++) {
        for (let h = 0; h <= K; h++) {
            const w = ((a - h) * (a - h)) / (K * K);
            const e = (aiHist[a] * huHist[h]) / n;
            num += w * O[a][h];
            den += w * e;
        }
    }
    if (den === 0) return 1; // perfect agreement (no spread)
    return 1 - num / den;
}

app.get('/api/analytics/agreement', verifyToken, (req, res) => {
    db.all(
        `SELECT student_id, subject, grade, exam, ai_total_marks, total_marks, max_marks, ai_confidence
         FROM scripts
         WHERE teacher_id = ? AND is_deleted = 0
           AND reviewed_at IS NOT NULL AND ai_total_marks IS NOT NULL`,
        [req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const pairs = rows
                .map(r => {
                    const max = r.max_marks || 10;
                    return {
                        student_id: r.student_id,
                        subject: r.subject,
                        ai: r.ai_total_marks,
                        human: r.total_marks,
                        max,
                        ai_pct: Math.max(0, Math.min(100, (r.ai_total_marks / max) * 100)),
                        human_pct: Math.max(0, Math.min(100, (r.total_marks / max) * 100)),
                        confidence: r.ai_confidence,
                    };
                })
                .filter(p => Number.isFinite(p.ai) && Number.isFinite(p.human));

            const n = pairs.length;
            if (n === 0) {
                return res.json({ n: 0, message: 'No reviewed scripts yet. Review some AI-graded scripts to populate this dashboard.' });
            }

            let exact = 0, within1 = 0, sumAbs = 0, sumSigned = 0;
            const aiCats = [], huCats = [];      // 0..10 deciles of percentage
            for (const p of pairs) {
                const delta = p.human - p.ai;     // +ve => teacher graded higher than AI
                if (delta === 0) exact++;
                if (Math.abs(delta) <= 1) within1++;
                sumAbs += Math.abs(delta);
                sumSigned += delta;
                aiCats.push(Math.round(p.ai_pct / 10));
                huCats.push(Math.round(p.human_pct / 10));
            }

            res.json({
                n,
                exactAgreementPct: +(100 * exact / n).toFixed(1),
                within1MarkPct: +(100 * within1 / n).toFixed(1),
                maeMarks: +(sumAbs / n).toFixed(2),       // mean absolute error (marks)
                biasMarks: +(sumSigned / n).toFixed(2),   // mean signed error (teacher - AI)
                qwk: (() => { const k = quadraticWeightedKappa(aiCats, huCats, 10); return k === null ? null : +k.toFixed(3); })(),
                pairs,
            });
        }
    );
});

// ── Text-to-speech proxy ────────────────────────────────────────────────
// The onboarding tour narrates in English, Sinhala and Tamil. Browsers block
// the public Google Translate TTS endpoint when an <audio> tag points at it
// directly (ORB / no CORS headers), so we proxy it here — same-origin — and
// stream the MP3 back. Public (no token): an <audio> element can't send the
// Authorization header. `q` is capped at 200 chars to match the upstream limit.
const https = require('https');
app.get('/api/tts', (req, res) => {
    const text = (req.query.q || '').toString().slice(0, 200);
    const tl = (req.query.tl || 'en').toString().slice(0, 5);
    if (!text) return res.status(400).json({ error: 'Missing q parameter' });

    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx` +
        `&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`;

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
        if (upstream.statusCode !== 200) {
            upstream.resume();
            return res.status(502).json({ error: 'TTS upstream failed', code: upstream.statusCode });
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        upstream.pipe(res);
    }).on('error', (err) => {
        res.status(502).json({ error: 'TTS request error', detail: err.message });
    });
});

// Serve the built frontend (if present) so the whole app can run from one port.
// Generate it with `npm run build` inside /frontend. Registered after the API
// routes so /api and /uploads always take precedence.
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            return res.sendFile(path.join(distPath, 'index.html'));
        }
        next();
    });
    console.log('Serving frontend build from', distPath);
}

// Export pure grading helpers for unit testing. Only starts the HTTP server
// when run directly (node server.js), not when required by a test.
module.exports = { parseTranscriptionAnswers, applyBlindVerification };

if (require.main === module)
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Seed a demo teacher for local development only — never auto-create a
    // known-password account in production.
    if (process.env.NODE_ENV !== 'production') {
        const hash = await bcrypt.hash('password123', 10);
        db.run('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)', ['teacher', hash, 'Teacher']);
    }

// ════════════════════════════════════════════════════════════════════════════
// TEACHER TOOLS — Attendance, Timetable, Lesson Plans, Notices
// ════════════════════════════════════════════════════════════════════════════

// ── ATTENDANCE ───────────────────────────────────────────────────────────────

// Get attendance for a class on a specific date
app.get('/api/attendance', verifyToken, (req, res) => {
    const { class_id, date } = req.query;
    if (!class_id || !date) return res.status(400).json({ error: 'class_id and date required' });
    // Verify class belongs to this teacher before returning data.
    db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [class_id, req.user.id], (err0, cls) => {
        if (err0 || !cls) return res.status(404).json({ error: 'Class not found' });
        db.all(
            `SELECT a.*, s.name AS student_name, s.student_id AS student_code
             FROM attendance a
             JOIN students s ON a.student_id = s.id
             WHERE a.class_id = ? AND a.date = ? AND a.teacher_id = ?
             ORDER BY s.name`,
            [class_id, date, req.user.id],
            (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
        );
    });
});

// Save/update a full day's attendance (batch upsert)
app.post('/api/attendance', verifyToken, (req, res) => {
    const { class_id, date, records } = req.body; // records: [{student_id, status, note}]
    if (!class_id || !date || !Array.isArray(records))
        return res.status(400).json({ error: 'class_id, date, records[] required' });

    // Verify class belongs to this teacher.
    db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [class_id, req.user.id], (err, cls) => {
        if (err || !cls) return res.status(404).json({ error: 'Class not found' });

        const stmt = db.prepare(
            `INSERT INTO attendance (teacher_id, class_id, student_id, date, status, note)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(class_id, student_id, date) DO UPDATE SET status=excluded.status, note=excluded.note`
        );
        let saved = 0;
        for (const r of records) {
            stmt.run(req.user.id, class_id, r.student_id, date, r.status || 'present', r.note || '', (err2) => {
                if (!err2) saved++;
            });
        }
        stmt.finalize(() => res.json({ saved }));
    });
});

// Attendance report: summary per student over a date range
app.get('/api/attendance/report', verifyToken, (req, res) => {
    const { class_id, from, to } = req.query;
    if (!class_id) return res.status(400).json({ error: 'class_id required' });
    // Verify class belongs to this teacher so student names don't leak.
    db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [class_id, req.user.id], (err0, cls) => {
        if (err0 || !cls) return res.status(404).json({ error: 'Class not found' });
        const fromDate = from || '2000-01-01';
        const toDate   = to   || '2099-12-31';
        db.all(
            `SELECT s.id AS student_id, s.name, s.student_id AS student_code,
                    COUNT(*) AS total_days,
                    SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absent,
                    SUM(CASE WHEN a.status='late'    THEN 1 ELSE 0 END) AS late,
                    SUM(CASE WHEN a.status='excused' THEN 1 ELSE 0 END) AS excused
             FROM students s
             LEFT JOIN attendance a ON a.student_id = s.id
                 AND a.class_id = ? AND a.date BETWEEN ? AND ? AND a.teacher_id = ?
             WHERE s.class_id = ?
             GROUP BY s.id ORDER BY s.name`,
            [class_id, fromDate, toDate, req.user.id, class_id],
            (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
        );
    });
});

// Monthly calendar view: which dates had attendance recorded for a class
app.get('/api/attendance/dates', verifyToken, (req, res) => {
    const { class_id, month } = req.query; // month = 'YYYY-MM'
    if (!class_id) return res.status(400).json({ error: 'class_id required' });
    const pattern = month ? `${month}%` : '%';
    db.all(
        `SELECT DISTINCT date FROM attendance
         WHERE class_id = ? AND teacher_id = ? AND date LIKE ?
         ORDER BY date`,
        [class_id, req.user.id, pattern],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows.map(r => r.date))
    );
});

// ── TIMETABLE ────────────────────────────────────────────────────────────────

app.get('/api/timetable', verifyToken, (req, res) => {
    db.all(
        `SELECT * FROM timetable_slots WHERE teacher_id = ? ORDER BY day, period`,
        [req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
    );
});

app.post('/api/timetable', verifyToken, (req, res) => {
    const { day, period, start_time, end_time, subject, grade, class_name, room, color } = req.body;
    if (!day || !period) return res.status(400).json({ error: 'day and period required' });
    db.run(
        `INSERT INTO timetable_slots (teacher_id, day, period, start_time, end_time, subject, grade, class_name, room, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, day, period, start_time || '', end_time || '', subject || '', grade || '', class_name || '', room || '', color || '#4f46e5'],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/timetable/:id', verifyToken, (req, res) => {
    const { day, period, start_time, end_time, subject, grade, class_name, room, color } = req.body;
    db.run(
        `UPDATE timetable_slots SET day=?, period=?, start_time=?, end_time=?, subject=?, grade=?, class_name=?, room=?, color=?
         WHERE id=? AND teacher_id=?`,
        [day, period, start_time || '', end_time || '', subject || '', grade || '', class_name || '', room || '', color || '#4f46e5', req.params.id, req.user.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })
    );
});

app.delete('/api/timetable/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM timetable_slots WHERE id=? AND teacher_id=?`,
        [req.params.id, req.user.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })
    );
});

// ── LESSON PLANS ─────────────────────────────────────────────────────────────

app.get('/api/lesson-plans', verifyToken, (req, res) => {
    db.all(
        `SELECT id, title, grade, subject, topic, date, duration, created_at
         FROM lesson_plans WHERE teacher_id = ? ORDER BY created_at DESC`,
        [req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
    );
});

app.get('/api/lesson-plans/:id', verifyToken, (req, res) => {
    db.get(
        `SELECT * FROM lesson_plans WHERE id = ? AND teacher_id = ?`,
        [req.params.id, req.user.id],
        (err, row) => {
            if (err || !row) return res.status(404).json({ error: 'Not found' });
            res.json({ ...row, plan: (() => { try { return JSON.parse(row.plan); } catch { return row.plan; } })() });
        }
    );
});

// AI-generate a lesson plan
app.post('/api/lesson-plans/generate', verifyToken, async (req, res) => {
    const { grade, subject, topic, duration = '45 minutes', language = 'English' } = req.body;
    if (!grade || !subject || !topic) return res.status(400).json({ error: 'grade, subject, topic required' });

    const langNote = language !== 'English'
        ? `Write the lesson plan in ${language}, keeping English technical terms in English as they appear in Sri Lankan textbooks.`
        : '';

    const prompt = `You are an experienced ${grade} ${subject} teacher. Create a detailed lesson plan. ${langNote}

Grade: ${grade} | Subject: ${subject} | Topic: ${topic} | Duration: ${duration}

Return a JSON object with this structure:
{
  "title": "Lesson title",
  "grade": "${grade}",
  "subject": "${subject}",
  "topic": "${topic}",
  "duration": "${duration}",
  "objectives": ["By end of lesson students will be able to..."],
  "materials": ["Textbook", "Whiteboard", ...],
  "sections": [
    { "name": "Introduction", "duration": "5 min", "activity": "...", "teacher_action": "...", "student_action": "..." },
    { "name": "Main Activity", "duration": "25 min", "activity": "...", "teacher_action": "...", "student_action": "..." },
    { "name": "Practice", "duration": "10 min", "activity": "...", "teacher_action": "...", "student_action": "..." },
    { "name": "Conclusion", "duration": "5 min", "activity": "...", "teacher_action": "...", "student_action": "..." }
  ],
  "assessment": "How you will check understanding",
  "homework": "Optional homework assignment",
  "notes": "Any teaching tips or differentiation notes"
}

Return ONLY raw JSON.`;

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2500,
            temperature: 0.4,
            response_format: { type: 'json_object' },
        });
        let plan;
        try { plan = JSON.parse(resp.choices[0].message.content); }
        catch { return res.status(500).json({ error: 'AI returned invalid JSON' }); }
        res.json({ plan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lesson-plans', verifyToken, (req, res) => {
    const { title, grade, subject, topic, date, duration, plan } = req.body;
    db.run(
        `INSERT INTO lesson_plans (teacher_id, title, grade, subject, topic, date, duration, plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, title || topic, grade, subject, topic, date || '', duration || '45 minutes', JSON.stringify(plan)],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/lesson-plans/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM lesson_plans WHERE id=? AND teacher_id=?`,
        [req.params.id, req.user.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })
    );
});

// ── NOTICES (parent communication) ───────────────────────────────────────────

app.get('/api/notices', verifyToken, (req, res) => {
    db.all(
        `SELECT * FROM notices WHERE teacher_id = ? ORDER BY sent_at DESC`,
        [req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows)
    );
});

app.post('/api/notices', verifyToken, (req, res) => {
    const { title, body, target_grade, target_class } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    db.run(
        `INSERT INTO notices (teacher_id, title, body, target_grade, target_class) VALUES (?, ?, ?, ?, ?)`,
        [req.user.id, title, body, target_grade || '', target_class || ''],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/notices/:id', verifyToken, (req, res) => {
    db.run(
        `DELETE FROM notices WHERE id=? AND teacher_id=?`,
        [req.params.id, req.user.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true })
    );
});

// ── AI-generate a notice ─────────────────────────────────────────────────────
app.post('/api/notices/generate', verifyToken, async (req, res) => {
    const { type, grade, details, language = 'English' } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });

    const prompt = `You are a school teacher writing a short notice/message for parents.
Type: ${type}
Grade: ${grade || 'All grades'}
Details: ${details || ''}
Language: ${language}

Write a brief, professional, friendly notice suitable to send to parents. Keep it under 150 words.
${language !== 'English' ? `Write in ${language}, keeping school/subject terms in English where appropriate.` : ''}

Return JSON: { "title": "...", "body": "..." }`;

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 400,
            response_format: { type: 'json_object' },
        });
        res.json(JSON.parse(resp.choices[0].message.content));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// ONLINE MCQ QUIZZES
// ════════════════════════════════════════════════════════════════════════════

// AI-generate MCQ questions from a topic (optionally grounded in a textbook).
app.post('/api/quizzes/generate', verifyToken, async (req, res) => {
    const { grade, subject, topic, count = 5, difficulty = 'Medium', language = 'English', context_id } = req.body;
    if (!topic && !context_id) return res.status(400).json({ error: 'topic or textbook required' });

    let source = '';
    if (context_id) {
        const ctx = await new Promise(r => db.get('SELECT content FROM subject_contexts WHERE id = ? AND teacher_id = ?', [context_id, req.user.id], (e, row) => r(row)));
        if (ctx) { try { const p = JSON.parse(ctx.content); source = (p.summary || '') + '\n' + (p.raw || '').slice(0, 8000); } catch {} }
    }

    const langRule = language !== 'English'
        ? `Write everything in ${language}, but keep English technical terms (e.g. "Input Device", "Software") in English as they appear in Sri Lankan textbooks.`
        : '';

    const prompt = `You are an expert ${grade} ${subject} teacher. Create ${count} multiple-choice questions on "${topic}". Difficulty: ${difficulty}. ${langRule}
${source ? `Base the questions ONLY on this textbook content:\n${source}` : ''}

Each question has exactly 4 options and one correct answer. Return JSON:
{
  "questions": [
    { "text": "Question?", "options": ["A","B","C","D"], "correct": 0, "explanation": "Why this is correct" }
  ]
}
"correct" is the 0-based index of the right option. Return ONLY raw JSON.`;

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 3000,
            temperature: 0.5,
            response_format: { type: 'json_object' },
        });
        const data = JSON.parse(resp.choices[0].message.content);
        res.json({ questions: data.questions || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create / save a quiz
app.post('/api/quizzes', verifyToken, (req, res) => {
    const { title, grade, subject, class_id, questions, time_limit, is_published } = req.body;
    if (!title || !Array.isArray(questions) || questions.length === 0)
        return res.status(400).json({ error: 'title and questions required' });
    db.run(
        `INSERT INTO quizzes (teacher_id, class_id, title, grade, subject, questions, time_limit, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, class_id || null, title, grade || '', subject || '', JSON.stringify(questions), time_limit || 0, is_published ? 1 : 0],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

// List teacher's quizzes (with attempt counts)
app.get('/api/quizzes', verifyToken, (req, res) => {
    db.all(
        `SELECT q.id, q.title, q.grade, q.subject, q.class_id, q.time_limit, q.is_published, q.created_at,
                c.name AS class_name,
                (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id) AS attempts,
                json_array_length(q.questions) AS question_count
         FROM quizzes q LEFT JOIN classes c ON q.class_id = c.id
         WHERE q.teacher_id = ? ORDER BY q.created_at DESC`,
        [req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || [])
    );
});

// Get one quiz (full, with answers — teacher only)
app.get('/api/quizzes/:id', verifyToken, (req, res) => {
    db.get('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [req.params.id, req.user.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Quiz not found' });
        res.json({ ...row, questions: JSON.parse(row.questions || '[]') });
    });
});

// Toggle publish
app.put('/api/quizzes/:id/publish', verifyToken, (req, res) => {
    db.run('UPDATE quizzes SET is_published = ? WHERE id = ? AND teacher_id = ?',
        [req.body.is_published ? 1 : 0, req.params.id, req.user.id],
        (err) => err ? res.status(500).json({ error: err.message }) : res.json({ ok: true }));
});

app.delete('/api/quizzes/:id', verifyToken, (req, res) => {
    db.run('DELETE FROM quizzes WHERE id = ? AND teacher_id = ?', [req.params.id, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run('DELETE FROM quiz_attempts WHERE quiz_id = ?', [req.params.id]);
        res.json({ ok: true });
    });
});

// Teacher: view all attempts/results for a quiz
app.get('/api/quizzes/:id/results', verifyToken, (req, res) => {
    db.all(
        `SELECT a.id, a.score, a.total, a.submitted_at, s.name, s.student_id
         FROM quiz_attempts a JOIN students s ON a.student_id = s.id
         JOIN quizzes q ON a.quiz_id = q.id
         WHERE a.quiz_id = ? AND q.teacher_id = ?
         ORDER BY a.score DESC`,
        [req.params.id, req.user.id],
        (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || [])
    );
});

// ════════════════════════════════════════════════════════════════════════════
// LIVE QUIZ MODE (Kahoot-style) — in-memory sessions, HTTP polling, no sockets.
// A session is short-lived, so an in-memory store is ideal (and survives the
// length of any single game).
// ════════════════════════════════════════════════════════════════════════════
const liveSessions = new Map(); // pin -> session

function makePin() {
    let pin;
    do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (liveSessions.has(pin));
    return pin;
}

// Persist every player's score to the DB once, when a session ends.
function persistLiveScores(s) {
    if (s._saved) return;
    s._saved = true;
    const stmt = db.prepare(
        `INSERT INTO live_scores (teacher_id, student_id, quiz_id, quiz_title, score) VALUES (?, ?, ?, ?, ?)`
    );
    for (const [studentId, p] of Object.entries(s.players)) {
        if (p.score > 0) stmt.run(s.teacherId, studentId, s.quizId, s.title, p.score);
    }
    stmt.finalize();
}

// Teacher: start a live session for one of their quizzes.
app.post('/api/live/start', verifyToken, (req, res) => {
    const { quiz_id } = req.body;
    db.get('SELECT * FROM quizzes WHERE id = ? AND teacher_id = ?', [quiz_id, req.user.id], (err, quiz) => {
        if (err || !quiz) return res.status(404).json({ error: 'Quiz not found' });
        const questions = JSON.parse(quiz.questions || '[]');
        if (!questions.length) return res.status(400).json({ error: 'Quiz has no questions' });
        const pin = makePin();
        liveSessions.set(pin, {
            pin, quizId: quiz.id, teacherId: req.user.id, title: quiz.title,
            questions, phase: 'lobby', currentQ: -1, questionStartedAt: 0,
            questionDuration: 20, // seconds per question
            players: {}, // studentId -> { name, score, answers: {q:opt}, lastPoints }
        });
        res.json({ pin, title: quiz.title, total: questions.length });
    });
});

// Teacher: advance the session. lobby -> Q0 -> reveal -> Q1 -> reveal ... -> ended
app.post('/api/live/:pin/next', verifyToken, (req, res) => {
    const s = liveSessions.get(req.params.pin);
    if (!s || s.teacherId !== req.user.id) return res.status(404).json({ error: 'Session not found' });

    if (s.phase === 'lobby' || s.phase === 'reveal') {
        const next = s.currentQ + 1;
        if (next >= s.questions.length) { s.phase = 'ended'; persistLiveScores(s); }
        else { s.currentQ = next; s.phase = 'question'; s.questionStartedAt = Date.now(); }
    } else if (s.phase === 'question') {
        s.phase = 'reveal';
    }
    res.json({ phase: s.phase, currentQ: s.currentQ });
});

app.post('/api/live/:pin/end', verifyToken, (req, res) => {
    const s = liveSessions.get(req.params.pin);
    if (s && s.teacherId === req.user.id) {
        s.phase = 'ended';
        persistLiveScores(s);
        setTimeout(() => liveSessions.delete(req.params.pin), 60000);
    }
    res.json({ ok: true });
});

function leaderboard(s) {
    return Object.values(s.players)
        .map(p => ({ name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((p, i) => ({ ...p, rank: i + 1 }));
}

function secondsLeft(s) {
    if (s.phase !== 'question') return null;
    const elapsed = (Date.now() - s.questionStartedAt) / 1000;
    return Math.max(0, Math.ceil(s.questionDuration - elapsed));
}

// Teacher: live state (question with answer, per-option counts, leaderboard).
app.get('/api/live/:pin/state', verifyToken, (req, res) => {
    const s = liveSessions.get(req.params.pin);
    if (!s || s.teacherId !== req.user.id) return res.status(404).json({ error: 'Session not found' });
    const q = s.currentQ >= 0 ? s.questions[s.currentQ] : null;
    const counts = [0, 0, 0, 0];
    let answered = 0;
    if (q) for (const p of Object.values(s.players)) {
        const a = p.answers[s.currentQ];
        if (a !== undefined && a >= 0) { counts[a]++; answered++; }
    }
    res.json({
        phase: s.phase, currentQ: s.currentQ, total: s.questions.length,
        playerCount: Object.keys(s.players).length, answered,
        secondsLeft: secondsLeft(s), duration: s.questionDuration,
        question: q ? {
            text: q.text, options: q.options,
            correct: (s.phase === 'reveal' || s.phase === 'ended') ? q.correct : undefined,
            explanation: (s.phase === 'reveal' || s.phase === 'ended') ? q.explanation : undefined,
        } : null,
        counts: (s.phase === 'reveal' || s.phase === 'ended') ? counts : undefined,
        leaderboard: leaderboard(s),
    });
});

// Student: join a session by PIN.
app.post('/api/live/join', verifyToken, verifyStudent, async (req, res) => {
    const s = liveSessions.get(String(req.body.pin || '').trim());
    if (!s) return res.status(404).json({ error: 'No live quiz with that PIN. Check the code.' });
    if (s.phase === 'ended') return res.status(400).json({ error: 'This quiz has already ended.' });
    const stu = await new Promise(r => db.get('SELECT name, student_id FROM students WHERE id = ?', [req.user.id], (e, row) => r(row)));
    if (!s.players[req.user.id]) {
        s.players[req.user.id] = { name: stu?.name || stu?.student_id || 'Student', score: 0, answers: {}, lastPoints: 0 };
    }
    res.json({ pin: s.pin, title: s.title, total: s.questions.length });
});

// Student: poll the play state (question WITHOUT answer, their score/result).
app.get('/api/live/:pin/play', verifyToken, verifyStudent, (req, res) => {
    const s = liveSessions.get(req.params.pin);
    if (!s) return res.status(404).json({ error: 'Session ended' });
    const me = s.players[req.user.id] || { score: 0, answers: {}, lastPoints: 0 };
    const q = s.currentQ >= 0 ? s.questions[s.currentQ] : null;
    const myAnswer = q ? me.answers[s.currentQ] : undefined;
    const board = leaderboard(s);
    const myRank = (board.findIndex(b => b.name === me.name) + 1) || null;
    res.json({
        phase: s.phase, currentQ: s.currentQ, total: s.questions.length,
        secondsLeft: secondsLeft(s), duration: s.questionDuration,
        question: q && s.phase === 'question' ? { text: q.text, options: q.options } : null,
        reveal: (s.phase === 'reveal' || s.phase === 'ended') && q
            ? { correct: q.correct, explanation: q.explanation, yourAnswer: myAnswer, gotIt: myAnswer === q.correct, points: me.lastPoints }
            : null,
        answered: myAnswer !== undefined,
        myScore: me.score, myRank, leaderboard: board,
    });
});

// Student: submit an answer (scored by correctness + speed).
app.post('/api/live/:pin/answer', verifyToken, verifyStudent, (req, res) => {
    const s = liveSessions.get(req.params.pin);
    if (!s || s.phase !== 'question') return res.status(400).json({ error: 'Not accepting answers now' });
    const me = s.players[req.user.id];
    if (!me) return res.status(400).json({ error: 'You have not joined' });
    if (me.answers[s.currentQ] !== undefined) return res.json({ ok: true }); // already answered

    const opt = Number(req.body.option);
    me.answers[s.currentQ] = opt;
    const q = s.questions[s.currentQ];
    let points = 0;
    if (opt === q.correct) {
        const elapsed = Date.now() - s.questionStartedAt;
        const speedBonus = Math.max(0, 500 - Math.floor(elapsed / 40)); // up to +500, decays ~20s
        points = 500 + speedBonus;
    }
    me.lastPoints = points;
    me.score += points;
    res.json({ ok: true, points });
});

// ── LIFETIME LEADERBOARD (persisted live-quiz points) ───────────────────────
// Teacher view: all-time rankings across their students, optionally by class.
app.get('/api/leaderboard/lifetime', verifyToken, (req, res) => {
    const { class_id } = req.query;
    let sql = `SELECT s.name, s.student_id AS code, c.name AS class_name,
                      SUM(ls.score) AS total, COUNT(*) AS games, MAX(ls.score) AS best
               FROM live_scores ls
               JOIN students s ON ls.student_id = s.id
               JOIN classes c ON s.class_id = c.id
               WHERE ls.teacher_id = ?`;
    const p = [req.user.id];
    if (class_id) { sql += ' AND s.class_id = ?'; p.push(class_id); }
    sql += ' GROUP BY ls.student_id ORDER BY total DESC LIMIT 50';
    db.all(sql, p, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((rows || []).map((r, i) => ({ ...r, rank: i + 1 })));
    });
});

// Student view: their class lifetime leaderboard, self highlighted.
app.get('/api/student/lifetime-leaderboard', verifyToken, verifyStudent, (req, res) => {
    db.get('SELECT class_id FROM students WHERE id = ?', [req.user.id], (e, stu) => {
        db.all(
            `SELECT s.id, s.name, s.student_id AS code,
                    COALESCE(SUM(ls.score), 0) AS total, COUNT(ls.id) AS games
             FROM students s
             LEFT JOIN live_scores ls ON ls.student_id = s.id
             WHERE s.class_id = ?
             GROUP BY s.id ORDER BY total DESC LIMIT 50`,
            [stu?.class_id],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json((rows || []).map((r, i) => ({
                    rank: i + 1, name: r.name || r.code, total: r.total, games: r.games,
                    isMe: r.id === req.user.id,
                })));
            }
        );
    });
});

// ── STUDENT quiz endpoints ───────────────────────────────────────────────────

// Available quizzes for the logged-in student's class (published only).
app.get('/api/student/quizzes', verifyToken, verifyStudent, (req, res) => {
    db.get('SELECT class_id FROM students WHERE id = ?', [req.user.id], (e, stu) => {
        if (e || !stu) return res.status(404).json({ error: 'Student not found' });
        db.all(
            `SELECT q.id, q.title, q.grade, q.subject, q.time_limit,
                    json_array_length(q.questions) AS question_count,
                    a.score, a.total, a.submitted_at
             FROM quizzes q
             LEFT JOIN quiz_attempts a ON a.quiz_id = q.id AND a.student_id = ?
             WHERE q.is_published = 1 AND (q.class_id = ? OR q.class_id IS NULL) AND q.teacher_id = ?
             ORDER BY q.created_at DESC`,
            [req.user.id, stu.class_id, req.user.teacher_id],
            (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows || [])
        );
    });
});

// Get a quiz to take — questions WITHOUT the correct answers.
app.get('/api/student/quizzes/:id', verifyToken, verifyStudent, (req, res) => {
    db.get('SELECT * FROM quizzes WHERE id = ? AND is_published = 1 AND teacher_id = ?',
        [req.params.id, req.user.teacher_id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Quiz not available' });
        const questions = JSON.parse(row.questions || '[]').map(q => ({ text: q.text, options: q.options }));
        res.json({ id: row.id, title: row.title, grade: row.grade, subject: row.subject, time_limit: row.time_limit, questions });
    });
});

// Submit answers → instant grading + per-question feedback.
app.post('/api/student/quizzes/:id/submit', verifyToken, verifyStudent, (req, res) => {
    const { answers } = req.body; // array of selected option indices
    db.get('SELECT * FROM quizzes WHERE id = ? AND is_published = 1 AND teacher_id = ?',
        [req.params.id, req.user.teacher_id], (err, quiz) => {
        if (err || !quiz) return res.status(404).json({ error: 'Quiz not available' });

        const questions = JSON.parse(quiz.questions || '[]');
        let score = 0;
        const feedback = questions.map((q, i) => {
            const chosen = answers?.[i];
            const correct = chosen === q.correct;
            if (correct) score++;
            return {
                text: q.text,
                options: q.options,
                your_answer: chosen,
                correct_answer: q.correct,
                is_correct: correct,
                explanation: q.explanation || '',
            };
        });
        const total = questions.length;

        // Save attempt (upsert — latest submission wins).
        db.run(
            `INSERT INTO quiz_attempts (quiz_id, student_id, answers, score, total)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(quiz_id, student_id) DO UPDATE SET answers=excluded.answers, score=excluded.score, total=excluded.total, submitted_at=CURRENT_TIMESTAMP`,
            [req.params.id, req.user.id, JSON.stringify(answers || []), score, total],
            (e) => {
                if (e) return res.status(500).json({ error: e.message });
                res.json({ score, total, percentage: Math.round((score / total) * 100), feedback });
            }
        );
    });
});

// ════════════════════════════════════════════════════════════════════════════
// AI CLASS INSIGHTS — analyse results, flag at-risk students, recommend actions
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/insights', verifyToken, async (req, res) => {
    const { grade, subject } = req.body || {};
    try {
        // Pull all graded scripts for this teacher (optionally filtered).
        const rows = await new Promise((resolve, reject) => {
            let sql = `SELECT student_id, subject, grade, exam, total_marks, max_marks, upload_timestamp
                       FROM scripts WHERE teacher_id = ? AND is_deleted = 0 AND total_marks IS NOT NULL`;
            const p = [req.user.id];
            if (grade)   { sql += ' AND grade = ?';   p.push(grade); }
            if (subject) { sql += ' AND subject = ?'; p.push(subject); }
            db.all(sql, p, (e, r) => e ? reject(e) : resolve(r || []));
        });

        if (rows.length === 0) return res.json({ empty: true, message: 'No graded papers yet. Grade some papers to unlock AI insights.' });

        const pct = (r) => (r.max_marks ? (r.total_marks / r.max_marks) * 100 : 0);

        // Per-student aggregation (with simple trend from first→last attempt).
        const byStudent = {};
        for (const r of rows) {
            const s = byStudent[r.student_id] || (byStudent[r.student_id] = { scores: [], subjects: {} });
            s.scores.push({ p: pct(r), t: r.upload_timestamp });
            s.subjects[r.subject] = s.subjects[r.subject] || [];
            s.subjects[r.subject].push(pct(r));
        }

        const students = Object.entries(byStudent).map(([id, s]) => {
            const sorted = s.scores.slice().sort((a, b) => new Date(a.t) - new Date(b.t));
            const avg = s.scores.reduce((x, y) => x + y.p, 0) / s.scores.length;
            const trend = sorted.length >= 2 ? sorted[sorted.length - 1].p - sorted[0].p : 0;
            return { id, avg: Math.round(avg), count: s.scores.length, trend: Math.round(trend) };
        });

        const classAvg = Math.round(students.reduce((x, s) => x + s.avg, 0) / students.length);
        const atRisk = students.filter(s => s.avg < 50 || (s.avg < 60 && s.trend < -10))
                               .sort((a, b) => a.avg - b.avg);
        const topPerformers = students.filter(s => s.avg >= 75).sort((a, b) => b.avg - a.avg);

        // Per-subject averages.
        const subjAgg = {};
        for (const r of rows) {
            (subjAgg[r.subject] = subjAgg[r.subject] || []).push(pct(r));
        }
        const subjectStats = Object.entries(subjAgg).map(([name, arr]) => ({
            name, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), count: arr.length,
        })).sort((a, b) => a.avg - b.avg);

        // AI narrative.
        const summaryForAI = `Class average: ${classAvg}%. Students: ${students.length}. Papers graded: ${rows.length}.
Subject averages: ${subjectStats.map(s => `${s.name} ${s.avg}%`).join(', ')}.
At-risk students (id, avg%, trend): ${atRisk.slice(0, 8).map(s => `${s.id} (${s.avg}%, ${s.trend >= 0 ? '+' : ''}${s.trend})`).join('; ') || 'none'}.
Top performers: ${topPerformers.slice(0, 5).map(s => `${s.id} (${s.avg}%)`).join('; ') || 'none'}.`;

        let narrative = {};
        try {
            const resp = await openai.chat.completions.create({
                model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
                messages: [{
                    role: 'user',
                    content: `You are an education data analyst. Based on this class performance data, give the teacher actionable insights.
${summaryForAI}

Return JSON:
{
  "headline": "1 sentence overall summary",
  "strengths": ["what the class does well", "..."],
  "concerns": ["main weaknesses / topics to reteach", "..."],
  "at_risk_advice": "1-2 sentences on how to help the struggling students",
  "recommendations": ["concrete next action", "..."]
}
Keep it concise and practical. Return ONLY raw JSON.`,
                }],
                max_tokens: 700,
                temperature: 0.5,
                response_format: { type: 'json_object' },
            });
            narrative = JSON.parse(resp.choices[0].message.content);
        } catch { narrative = { headline: `Class average is ${classAvg}%.`, strengths: [], concerns: [], at_risk_advice: '', recommendations: [] }; }

        res.json({
            classAvg,
            totalStudents: students.length,
            totalPapers: rows.length,
            subjectStats,
            atRisk: atRisk.slice(0, 10),
            topPerformers: topPerformers.slice(0, 5),
            narrative,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// HELP ASSISTANT — answers teacher questions about how to use MarkNex
// ════════════════════════════════════════════════════════════════════════════
const MARKNEX_HELP_CONTEXT = `You are "MarkNex Assistant", a friendly help guide for teachers using the MarkNex teaching platform.
Answer questions about how to use the system. Keep answers short, clear and step-by-step (2-5 short steps).

MARKNEX FEATURES (sidebar menu):
- Dashboard: Upload student answer papers (PDF/photo). Pick the Class and Student from dropdowns, choose Exam, then "Process with AI" to auto-grade.
- Bulk MCQ Grader: Grade many multiple-choice answer sheets at once against an answer key.
- Bulk Essay Grader: Grade many essays at once using a marking scheme.
- Manage Assignments: Create assignments with questions, rubrics and max marks.
- Generate Papers: Auto-create exam papers from an uploaded textbook. Pick textbook, choose question types and counts, Generate, then print/share.
- Online Quizzes: Create MCQ quizzes (type them or generate with AI from a topic/textbook). Publish to a class. Students take them and get instant marks & feedback. View results per quiz.
- Teacher Tools: Attendance (mark daily present/absent), Timetable (weekly class schedule), Lesson Plans (AI-generate full plans), Notices (AI-draft parent messages).
- Class Reports / Analytics / AI vs Teacher: View performance reports and AI-vs-teacher grade agreement.
- Manage Everything: Add Classes, Students (with login accounts), Exams, and upload Textbooks (curriculum is extracted and used when grading).
- Settings: Manage Grade/Subject/Exam dropdown options.

STUDENT ACCOUNTS: In Manage Everything → Classes → Students, add a student and give a Username + Password. The student logs in via "I'm a Student" to see their results, AI improvement tips, quizzes and attendance.

TEXTBOOKS: In Manage Everything → Textbooks, pick Grade + Subject, choose language, upload a PDF. AI reads all pages and stores the curriculum. It is then auto-used when grading papers for that grade+subject.

GRADING: AI grades 3 times and averages for accuracy. After grading, open a report and click "AI Improvement Feedback" to generate study suggestions for the student.

If the question is not about MarkNex, politely say you can only help with the MarkNex system.`;

app.post('/api/assistant/ask', verifyToken, async (req, res) => {
    const { question, language = 'Sinhala' } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'question required' });

    const langRule = language === 'Sinhala'
        ? 'Answer in clear, simple Sinhala (සිංහල). Keep English technical/menu names in English (e.g. "Online Quizzes", "Dashboard", "Manage Everything") since that is how they appear in the app.'
        : language === 'Tamil'
        ? 'Answer in clear Tamil, keeping English menu names in English.'
        : 'Answer in clear, simple English.';

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.FINE_TUNED_MODEL_ID || 'gpt-4o',
            messages: [
                { role: 'system', content: `${MARKNEX_HELP_CONTEXT}\n\n${langRule}` },
                { role: 'user', content: question },
            ],
            max_tokens: 500,
            temperature: 0.4,
        });
        res.json({ answer: resp.choices[0].message.content.trim() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

    // Recover scripts left 'Pending' by an interrupted/crashed evaluation.
    // The in-memory AI job is lost on restart, so any Pending row is stuck —
    // flag it for manual review instead of polling forever.
    db.run(
        `UPDATE scripts SET status = 'Needs Review', total_marks = 0, confidence_score = 0,
         flags = 'AI Failed', report = 'AI evaluation was interrupted (server restarted). Please review and grade manually.'
         WHERE status = 'Pending'`,
        function (err) {
            if (err) console.error('Pending recovery error:', err.message);
            else if (this.changes > 0) console.log(`Recovered ${this.changes} interrupted (Pending) script(s).`);
        }
    );
});
