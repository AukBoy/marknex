// Unit test for blind-read verification logic (the 136/126 false-positive catch).
// Tests the pure functions directly so we don't depend on GPT-4o's non-deterministic OCR.
const assert = require('assert');
const { parseTranscriptionAnswers, applyBlindVerification } = require('./server');

let passed = 0, failed = 0;
function check(name, fn) {
    try { fn(); console.log('  PASS:', name); passed++; }
    catch (e) { console.log('  FAIL:', name, '→', e.message); failed++; }
}

// The biased transcription: Q5 misread as 126 (matches 42×3, so grader marks Correct)
const misreadTranscription =
`Q01: 4768 + 3986 → Student working: 4768\n+3986\n8754 → Final answer: 8754
Q05: 42 x 3 → Student working: 42\n× 3\n126 → Final answer: 126
Q06: 78 x 7 → Student working: 78\n× 7\n546 → Final answer: 546`;

console.log('parseTranscriptionAnswers:');
check('extracts final answer + computes correct for Q5', () => {
    const m = parseTranscriptionAnswers(misreadTranscription);
    assert.strictEqual(m['5'].finalAnswer, '126', 'final answer');
    assert.strictEqual(m['5'].correct, 126, '42×3=126');
});
check('handles addition (Q1)', () => {
    const m = parseTranscriptionAnswers(misreadTranscription);
    assert.strictEqual(m['1'].correct, 8754);
});

console.log('applyBlindVerification:');
check('FLIPS Q5 when blind read (136) differs from biased transcription (126)', () => {
    const qa = [
        { q_num: 'Q5', status: 'Correct', marks_awarded: 1, max_marks: 1, teacher_tip: 'Verified by math engine: 42 x 3 = 126, student wrote 126. Correct.' },
    ];
    const corrections = [];
    const flips = applyBlindVerification(qa, { '5': '136' }, misreadTranscription, corrections, '[Test]');
    assert.strictEqual(flips, 1, 'one flip');
    assert.strictEqual(qa[0].status, 'Incorrect', 'status flipped');
    assert.strictEqual(qa[0].marks_awarded, 0, 'marks zeroed');
    assert.strictEqual(corrections.length, 1, 'correction logged');
    assert.strictEqual(corrections[0].text, '136', 'logs what student actually wrote');
    assert.strictEqual(corrections[0].correct_answer, '126', 'logs correct answer');
});
check('does NOT flip when blind read agrees with transcription (both 126)', () => {
    const qa = [{ q_num: 'Q5', status: 'Correct', marks_awarded: 1, max_marks: 1, teacher_tip: '' }];
    const flips = applyBlindVerification(qa, { '5': '126' }, misreadTranscription, [], '[Test]');
    assert.strictEqual(flips, 0);
    assert.strictEqual(qa[0].status, 'Correct');
});
check('does NOT flip a question that was already Incorrect', () => {
    const qa = [{ q_num: 'Q5', status: 'Incorrect', marks_awarded: 0, max_marks: 1, teacher_tip: '' }];
    const flips = applyBlindVerification(qa, { '5': '136' }, misreadTranscription, [], '[Test]');
    assert.strictEqual(flips, 0);
});
check('does NOT flip when transcription did NOT match correct (not the bias signature)', () => {
    // transcription says 999 (already wrong but somehow marked Correct) — blind says 136.
    // transNum(999) !== correct(126), so this is not the "biased to look right" signature; leave it.
    const t = `Q05: 42 x 3 → Student working: 42\n× 3\n999 → Final answer: 999`;
    const qa = [{ q_num: 'Q5', status: 'Correct', marks_awarded: 1, max_marks: 1, teacher_tip: '' }];
    const flips = applyBlindVerification(qa, { '5': '136' }, t, [], '[Test]');
    assert.strictEqual(flips, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
