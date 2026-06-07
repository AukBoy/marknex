# Fine-Tuning GPT-4o for MarkNex - Complete Guide

## Overview

Fine-tuning allows you to customize the GPT-4o model to better understand:
- Your school's grading standards
- Subject-specific knowledge
- Your marking rubrics
- Your feedback style

This guide walks you through the entire process.

---

## Phase 1: Preparing Training Data

### Step 1: Collect Graded Answer Scripts

You need **at least 50-100 examples** of answer scripts that have been:
- Graded by experienced teachers
- Marked with final marks
- Annotated with feedback

**Where to get them:**
- Past exams (last 2-3 years)
- Student submissions from your system
- Past assessments with teacher marks

### Step 2: Prepare Training Examples

For each script, you need:

```json
{
  "script_content": "Student's answer text or description",
  "subject": "Math",
  "grade": "Grade 10",
  "exam": "Final Exam Term 1",
  "max_marks": 100,
  "expected_output": {
    "total_marks": 85,
    "confidence_score": 95,
    "feedback": "Good understanding of concepts. Work on showing more steps.",
    "question_analysis": [
      {
        "q_num": "1",
        "max_marks": 10,
        "marks_awarded": 9,
        "status": "Almost Correct",
        "teacher_tip": "Show working for mathematical steps"
      }
    ]
  }
}
```

### Step 3: Format for OpenAI Fine-Tuning

OpenAI requires **JSONL format** (one JSON object per line):

```jsonl
{"messages": [{"role": "system", "content": "You are an expert teacher grading answer scripts..."}, {"role": "user", "content": "Grade this script: [script content]"}, {"role": "assistant", "content": "{\"total_marks\": 85, \"confidence_score\": 95, ...}"}]}
{"messages": [{"role": "system", "content": "You are an expert teacher grading answer scripts..."}, {"role": "user", "content": "Grade this script: [script content]"}, {"role": "assistant", "content": "{\"total_marks\": 78, \"confidence_score\": 88, ...}"}]}
...
```

---

## Phase 2: Data Collection Template

### Create a CSV template for teachers to fill:

```csv
Student,Grade,Subject,Exam,MaxMarks,StudentAnswer,TeacherMarks,Confidence,Feedback,Q1_Marks,Q1_Feedback,Q2_Marks,Q2_Feedback,...
S001,10,Math,Final,100,"Student wrote...",85,95,"Good work. Minor errors...",9,"Show steps",8,"Check calculation",...
S002,10,Math,Final,100,"Student wrote...",78,88,"Incomplete...",8,"Needs more detail",7,"Review concept",...
```

### Save as: `training_data.csv`

---

## Phase 3: Automated Dataset Preparation

Create a Python script to convert your CSV to JSONL:

```python
import csv
import json
import sys

def csv_to_jsonl(csv_file, output_file):
    """Convert training CSV to JSONL format for OpenAI fine-tuning"""
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        with open(output_file, 'w', encoding='utf-8') as out:
            for row in reader:
                # Parse question marks from columns like Q1_Marks, Q2_Marks
                question_analysis = []
                q_num = 1
                while f"Q{q_num}_Marks" in row:
                    marks = row.get(f"Q{q_num}_Marks", "")
                    feedback = row.get(f"Q{q_num}_Feedback", "")
                    if marks:
                        question_analysis.append({
                            "q_num": str(q_num),
                            "marks_awarded": int(marks),
                            "teacher_tip": feedback
                        })
                    q_num += 1
                
                # Create training message
                system_prompt = """You are an expert educational grader. Grade student answer scripts fairly and provide constructive feedback. 
Output MUST be valid JSON with: total_marks, confidence_score, feedback, question_analysis array."""
                
                user_message = f"""Grade this answer script:

Subject: {row['Subject']}
Grade: {row['Grade']}
Exam: {row['Exam']}
Max Marks: {row['MaxMarks']}

Student Answer:
{row['StudentAnswer']}"""
                
                assistant_message = json.dumps({
                    "total_marks": int(row['TeacherMarks']),
                    "confidence_score": int(row['Confidence']),
                    "feedback": row['Feedback'],
                    "question_analysis": question_analysis
                })
                
                # Write JSONL line
                training_example = {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                        {"role": "assistant", "content": assistant_message}
                    ]
                }
                
                out.write(json.dumps(training_example) + '\n')
    
    print(f"✅ Converted {csv_file} to {output_file}")
    print(f"   Ready for fine-tuning!")

if __name__ == "__main__":
    csv_to_jsonl("training_data.csv", "training_data.jsonl")
```

**Usage:**
```bash
pip install openai
python prepare_training_data.py
```

---

## Phase 4: Fine-Tuning with OpenAI

### Step 1: Install OpenAI CLI

```bash
pip install --upgrade openai
```

### Step 2: Set Your API Key

```bash
# macOS/Linux
export OPENAI_API_KEY="sk-..."

# Windows (PowerShell)
$env:OPENAI_API_KEY="sk-..."
```

### Step 3: Upload and Fine-Tune

```bash
# List your files
openai api fine_tuning.jobs.list

# Create fine-tuning job
openai api fine_tuning.jobs.create \
  -m gpt-4o \
  --training_file training_data.jsonl

# Expected output:
# {
#   "id": "ftjob-abc123...",
#   "status": "queued",
#   "model": "gpt-4o",
#   "created_at": 1234567890
# }
```

### Step 4: Monitor Fine-Tuning

```bash
# Check status (replace with your job ID)
openai api fine_tuning.jobs.get -i ftjob-abc123...

# Watch logs in real-time
openai api fine_tuning.jobs.follow -i ftjob-abc123...

# List all jobs
openai api fine_tuning.jobs.list
```

**Status progression:**
- `queued` → `running` → `succeeded` (or `failed`)
- Takes **4-24 hours** depending on dataset size

### Step 5: Get Your Fine-Tuned Model ID

```bash
# Once status is "succeeded"
openai api fine_tuning.jobs.get -i ftjob-abc123...

# Look for: "fine_tuned_model": "gpt-4o-2024-06-05-ft-xxx"
# This is your custom model ID!
```

---

## Phase 5: Test Your Fine-Tuned Model

### Create a test script (`test_finetuned.py`):

```python
from openai import OpenAI

client = OpenAI(api_key="sk-...")

# Your fine-tuned model ID (from phase 4)
MODEL_ID = "gpt-4o-2024-06-05-ft-xxx"

def test_fine_tuned_model(script_text):
    """Test grading with your fine-tuned model"""
    
    response = client.chat.completions.create(
        model=MODEL_ID,
        messages=[
            {
                "role": "system",
                "content": "You are an expert educational grader. Grade student answer scripts fairly and provide constructive feedback. Output MUST be valid JSON with: total_marks, confidence_score, feedback, question_analysis array."
            },
            {
                "role": "user",
                "content": f"""Grade this answer script:

Subject: Math
Grade: Grade 10
Exam: Final Exam
Max Marks: 100

Student Answer:
{script_text}"""
            }
        ],
        max_tokens=1000,
        response_format={"type": "json_object"}
    )
    
    return response.choices[0].message.content

# Test with sample script
sample_script = """
Question 1: Solve 2x + 5 = 15
Answer: 2x = 10, x = 5

Question 2: Find the area of circle with radius 5cm
Answer: A = πr² = π(5)² = 25π ≈ 78.5 cm²

Question 3: Explain photosynthesis
Answer: Plants use sunlight to convert CO2 and water into glucose...
"""

result = test_fine_tuned_model(sample_script)
print("Fine-tuned Model Results:")
print(result)
```

**Run test:**
```bash
python test_finetuned.py
```

---

## Phase 6: Integrate into MarkNex

### Update `server.js` to use your fine-tuned model:

```javascript
// OLD CODE (around line 246)
const response = await openai.chat.completions.create({
    model: "gpt-4o",  // ← Change this
    messages,
    max_tokens: 2000,
    response_format: { type: "json_object" }
});

// NEW CODE - Use your fine-tuned model
const FINE_TUNED_MODEL = process.env.FINE_TUNED_MODEL_ID || "gpt-4o";

const response = await openai.chat.completions.create({
    model: FINE_TUNED_MODEL,  // ← Uses your custom model
    messages,
    max_tokens: 2000,
    response_format: { type: "json_object" }
});
```

### Update `.env` file:

```bash
OPENAI_API_KEY=sk-...
FINE_TUNED_MODEL_ID=gpt-4o-2024-06-05-ft-xxx
```

### Restart backend:

```bash
cd backend
npm start
```

---

## Phase 7: Performance Comparison

### Compare Original vs Fine-Tuned

Create `compare_models.py`:

```python
from openai import OpenAI
import json
import time

client = OpenAI(api_key="sk-...")

test_script = "Student answer text..."

def compare_models():
    """Compare original GPT-4o vs your fine-tuned model"""
    
    original_results = []
    finetuned_results = []
    
    # Test original model
    print("Testing original GPT-4o...")
    start = time.time()
    response_orig = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": f"Grade: {test_script}"}],
        max_tokens=1000,
        response_format={"type": "json_object"}
    )
    original_time = time.time() - start
    original_results = json.loads(response_orig.choices[0].message.content)
    
    # Test fine-tuned model
    print("Testing fine-tuned model...")
    start = time.time()
    response_ft = client.chat.completions.create(
        model="gpt-4o-2024-06-05-ft-xxx",
        messages=[{"role": "user", "content": f"Grade: {test_script}"}],
        max_tokens=1000,
        response_format={"type": "json_object"}
    )
    finetuned_time = time.time() - start
    finetuned_results = json.loads(response_ft.choices[0].message.content)
    
    # Compare
    print("\n=== COMPARISON ===")
    print(f"Original Marks: {original_results.get('total_marks')}")
    print(f"Fine-tuned Marks: {finetuned_results.get('total_marks')}")
    print(f"Original Time: {original_time:.2f}s")
    print(f"Fine-tuned Time: {finetuned_time:.2f}s")
    
compare_models()
```

---

## Checklist: Fine-Tuning Process

- [ ] **Collect Data** - Gather 50-100 graded answer scripts
- [ ] **Prepare CSV** - Format in `training_data.csv`
- [ ] **Convert to JSONL** - Run `prepare_training_data.py`
- [ ] **Validate JSONL** - Check format is correct
- [ ] **Upload & Fine-Tune** - Use OpenAI CLI
- [ ] **Monitor Progress** - Watch fine-tuning job
- [ ] **Get Model ID** - Save your `gpt-4o-2024-06-05-ft-xxx`
- [ ] **Test Model** - Run `test_finetuned.py`
- [ ] **Compare Results** - Check accuracy improvements
- [ ] **Integrate** - Update `server.js` and `.env`
- [ ] **Deploy** - Restart backend with new model
- [ ] **Monitor** - Track grading quality in MarkNex

---

## Cost Estimation

### Fine-Tuning Costs:

```
Training Examples:  50     $1.00
Training Examples:  100    $2.00
Training Examples:  500    $10.00
Training Examples:  1000   $20.00

One-time fine-tuning cost: $2-20
Monthly usage of fine-tuned model: Similar to GPT-4o pricing
```

### How to Save Money:

1. Start with 50-100 examples (cheaper, faster)
2. Test quality before scaling up
3. Use validation set to measure improvements
4. Only fine-tune when you see 5%+ improvement

---

## Best Practices

### 1. Data Quality
- ✅ Only include scripts with **correct teacher marks**
- ✅ Ensure marks match your **rubric exactly**
- ✅ Include diverse **difficulty levels** and **subjects**
- ❌ Don't include partial or uncertain gradings

### 2. Dataset Balance
- ✅ Mix high-scoring and low-scoring scripts
- ✅ Include edge cases (almost correct, common errors)
- ✅ Representative of your typical submissions
- ❌ Don't bias toward one grade level

### 3. Feedback Quality
- ✅ Write clear, actionable feedback
- ✅ Include specific mistakes and how to improve
- ✅ Use consistent language/style across examples
- ❌ Avoid vague feedback like "Good job" or "Wrong"

### 4. Testing
- ✅ Hold out 20% of data for testing
- ✅ Test on scripts NOT in training set
- ✅ Compare with original GPT-4o
- ✅ Get teacher review of sample gradings

---

## Troubleshooting

### Fine-Tuning Job Failed?

```bash
# Check error details
openai api fine_tuning.jobs.get -i ftjob-xxx...

# Common issues:
# - "Invalid JSONL format" → Check JSON syntax
# - "File too small" → Need at least 50 examples
# - "Invalid messages format" → Check message structure
```

### Model Not Improving?

1. Check training data quality
2. Increase number of examples (100→200→500)
3. Improve feedback quality
4. Check for data imbalance

### High Costs?

1. Start with fewer examples (50 instead of 500)
2. Use smaller base model (gpt-3.5-turbo)
3. Monitor usage regularly

---

## Next Steps

1. **Start collecting** answer scripts from past exams
2. **Create the CSV** template and have teachers fill it
3. **Run the preparation script** to generate JSONL
4. **Submit for fine-tuning** (you'll get a job ID)
5. **Test the model** when ready
6. **Integrate into MarkNex** when satisfied
7. **Monitor performance** over time

---

## Support

For OpenAI fine-tuning help:
- [OpenAI Fine-tuning Documentation](https://platform.openai.com/docs/guides/fine-tuning)
- [API Reference](https://platform.openai.com/docs/api-reference/fine-tuning)

For MarkNex integration help:
- Check `server.js` grading routes
- Review how AI responses are parsed
- Test with sample scripts first

---

**Good luck with fine-tuning! 🚀**

Once complete, your MarkNex will understand your school's specific grading standards and provide even better AI grades! 📚✨
