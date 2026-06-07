# 🚀 Fine-Tuning Quick Start - 5 Minutes to Custom AI Grading

## Overview
This guide gets you from zero to a custom AI grading model in 5 simple steps.

---

## Step 1: Collect Training Data (Fastest Part!)

### Option A: Use the CSV Template
```bash
# Get the template
training_data_template.csv  ← Uses this file

# Have teachers fill it with past exam data:
# - Student answers from last 2-3 years
# - Teacher marks and feedback
# - Minimum 50 scripts (aim for 100+)
```

### Option B: Export from Your System
```bash
# Export student submissions with marks:
# Student ID | Grade Level | Subject | Answer Text | Teacher Marks | Feedback
```

**File Format:** CSV with columns:
- `Student`, `Grade`, `Subject`, `Exam`, `MaxMarks`
- `StudentAnswer`, `TeacherMarks`, `Confidence` (0-100)
- `Feedback` (teacher's feedback)
- Optional: `Q1_Marks`, `Q1_Feedback`, `Q2_Marks`, etc.

---

## Step 2: Prepare Your Data (2 Minutes)

```bash
# Install Python (if not already installed)
# https://www.python.org/downloads/

# Install OpenAI CLI
pip install --upgrade openai

# Convert CSV to JSONL format
python prepare_finetuning_data.py training_data.csv training_data.jsonl

# Expected output:
# ✅ Conversion Complete!
# ✅ Converted: 85 examples
# 📁 Output file: training_data.jsonl
```

**What this does:**
- Converts your CSV to JSONL format
- Validates data quality
- Shows any errors or warnings
- Creates `training_data.jsonl` ready for OpenAI

---

## Step 3: Submit for Fine-Tuning (1 Click!)

```bash
# Set your API key
export OPENAI_API_KEY="sk-..."

# Upload and fine-tune
openai api fine_tuning.jobs.create \
  -m gpt-4o \
  -f training_data.jsonl

# You'll get a job ID like:
# ftjob-abc123xyz...

# Save this ID! You'll need it later.
```

**What happens:**
- OpenAI uploads your data
- Trains a custom GPT-4o model (4-24 hours)
- Sends you updates via email
- Returns a fine-tuned model ID when done

---

## Step 4: Monitor Progress (Optional)

```bash
# Check status
openai api fine_tuning.jobs.get -i ftjob-abc123xyz...

# Watch live logs
openai api fine_tuning.jobs.follow -i ftjob-abc123xyz...

# Expected output:
# "status": "running"
# "status": "succeeded"  ← You're done!
```

**Status progression:**
- `queued` (waiting) → `running` (training) → `succeeded` ✅

---

## Step 5: Use Your Model! 🎉

### Option A: Test First (Recommended)

```bash
# Test your fine-tuned model
python test_finetuned_model.py \
  --finetuned gpt-4o-2024-06-05-ft-abc123...

# Compare with original
python test_finetuned_model.py \
  --finetuned gpt-4o-2024-06-05-ft-abc123... \
  --compare

# Output:
# ✅ Tests completed: 3
# 📊 Average marks: 78.5
# 🎯 Average confidence: 91.2%
```

### Option B: Integrate Into MarkNex

**Update `.env` file:**
```bash
OPENAI_API_KEY=sk-...
FINE_TUNED_MODEL_ID=gpt-4o-2024-06-05-ft-abc123...
```

**Update `backend/server.js`:**
```javascript
// Around line 246, change:
const FINE_TUNED_MODEL = process.env.FINE_TUNED_MODEL_ID || "gpt-4o";

const response = await openai.chat.completions.create({
    model: FINE_TUNED_MODEL,  // ← Uses your custom model
    messages,
    max_tokens: 2000,
    response_format: { type: "json_object" }
});
```

**Restart backend:**
```bash
cd backend
npm start
```

**Done!** ✅ Your MarkNex now uses your custom AI model!

---

## Files You Have

| File | Purpose |
|------|---------|
| `FINE_TUNING_GUIDE.md` | Complete detailed guide |
| `training_data_template.csv` | Template for collecting data |
| `prepare_finetuning_data.py` | Convert CSV → JSONL |
| `test_finetuned_model.py` | Test and compare models |
| `FINETUNING_QUICKSTART.md` | This file (fast track) |

---

## Common Questions

### Q: How much training data do I need?
**A:** Minimum 50 examples, but 100+ is better. Quality matters more than quantity.

### Q: How long does it take?
**A:** 
- Data prep: 5 mins
- Fine-tuning: 4-24 hours (usually 4-8)
- Testing: 5 mins
- Total: **One day**

### Q: How much does it cost?
**A:** $2-20 for fine-tuning (one-time), plus normal API usage after.

### Q: Will my old grading stop working?
**A:** No! You can switch back to `gpt-4o` anytime by removing the env var.

### Q: Can I update the model?
**A:** Yes! Fine-tune again with more data to improve it. Use a new job ID.

### Q: What if fine-tuning fails?
**A:** Check the error with: `openai api fine_tuning.jobs.get -i [job-id]`
- Common issues: Bad JSON format, too few examples, corrupted data

---

## Troubleshooting

### "Invalid JSONL format" Error
```bash
# Check if JSON is valid
python -m json.tool training_data.jsonl | head

# Re-run the preparation script
python prepare_finetuning_data.py training_data.csv
```

### Model not improving quality
1. Check training data quality (bad marks get bad results)
2. Increase number of examples (50 → 200 → 500)
3. Improve feedback quality (detailed beats vague)
4. Test on scripts NOT in training set

### High API costs
```bash
# Use original model temporarily
# Remove/comment FINE_TUNED_MODEL_ID from .env
# Restart backend
```

---

## Example Workflow

```bash
# 1. Prepare data (2 min)
python prepare_finetuning_data.py training_data.csv training_data.jsonl

# 2. Submit job (1 min)
export OPENAI_API_KEY="sk-..."
openai api fine_tuning.jobs.create -m gpt-4o -f training_data.jsonl
# Output: ftjob-abc123...

# 3. Wait for completion (4-24 hours)
# Check email or run:
openai api fine_tuning.jobs.follow -i ftjob-abc123...

# 4. Test the model (5 min)
python test_finetuned_model.py --finetuned gpt-4o-2024-06-05-ft-abc123... --compare

# 5. Deploy to MarkNex (5 min)
# Edit .env and backend/server.js
# Restart backend
# Done! ✅
```

---

## Success Indicators

### ✅ You've Succeeded When:
- [ ] Training data collected (50+ scripts)
- [ ] CSV file created with teacher marks
- [ ] JSONL file generated without errors
- [ ] Fine-tuning job submitted
- [ ] Job status shows "succeeded"
- [ ] Test script shows improvement in marks/confidence
- [ ] Model integrated into MarkNex
- [ ] New uploads use your custom model

---

## Next: Full Details

For more details on:
- Data quality requirements
- Advanced fine-tuning options
- Performance optimization
- Multi-subject fine-tuning
- Cost analysis

→ See `FINE_TUNING_GUIDE.md`

---

## Support

**For OpenAI Issues:**
- [Fine-tuning docs](https://platform.openai.com/docs/guides/fine-tuning)
- [API reference](https://platform.openai.com/docs/api-reference)

**For MarkNex Issues:**
- Check `server.js` (around line 246)
- Verify `.env` has correct model ID
- Check backend logs for errors

---

## Ready? Let's Go! 🚀

1. Start collecting answer scripts
2. Fill the CSV template
3. Run the Python script
4. Submit to OpenAI
5. Deploy to MarkNex

**Questions?** See `FINE_TUNING_GUIDE.md` for detailed explanations!
