#!/usr/bin/env python3
"""
MarkNex Fine-tuning Data Preparation Script

Converts training data from CSV to JSONL format for OpenAI fine-tuning.
Usage: python prepare_finetuning_data.py <input.csv> <output.jsonl>
"""

import csv
import json
import sys
import os
from pathlib import Path

def validate_csv(file_path):
    """Validate CSV file has required columns"""
    required_cols = {
        'Student', 'Grade', 'Subject', 'Exam', 'MaxMarks',
        'StudentAnswer', 'TeacherMarks', 'Confidence', 'Feedback'
    }

    with open(file_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        cols = set(reader.fieldnames or [])
        missing = required_cols - cols

        if missing:
            print(f"❌ Missing required columns: {missing}")
            print(f"   Required: {', '.join(required_cols)}")
            return False
        print(f"✅ CSV validation passed")
        return True

def extract_question_analysis(row):
    """Extract question-level marks from row (Q1_Marks, Q1_Feedback, etc.)"""
    question_analysis = []
    q_num = 1

    while True:
        marks_col = f"Q{q_num}_Marks"
        feedback_col = f"Q{q_num}_Feedback"

        if marks_col not in row or not row[marks_col].strip():
            break

        try:
            marks = int(row[marks_col].strip())
            feedback = row.get(feedback_col, "").strip()

            question_analysis.append({
                "q_num": str(q_num),
                "marks_awarded": marks,
                "teacher_tip": feedback or "Review this question"
            })
            q_num += 1
        except (ValueError, KeyError):
            break

    return question_analysis

def csv_to_jsonl(csv_file, output_file):
    """Convert training CSV to JSONL format for OpenAI fine-tuning"""

    if not os.path.exists(csv_file):
        print(f"❌ File not found: {csv_file}")
        return False

    if not validate_csv(csv_file):
        return False

    system_prompt = """You are an expert educational grader for a school. Grade student answer scripts fairly and accurately according to the teacher's rubric.
Provide detailed feedback that helps students improve.

Output MUST be valid JSON with these fields:
- total_marks: integer mark awarded
- confidence_score: 0-100 confidence in the grading
- feedback: constructive feedback for the student
- question_analysis: array of question-level analysis"""

    converted_count = 0
    error_count = 0

    try:
        with open(csv_file, 'r', encoding='utf-8') as f_in:
            reader = csv.DictReader(f_in)

            with open(output_file, 'w', encoding='utf-8') as f_out:
                for row_num, row in enumerate(reader, start=2):  # start=2 because row 1 is header
                    try:
                        # Validate required fields
                        if not row.get('StudentAnswer', '').strip():
                            print(f"⚠️  Row {row_num}: Empty student answer, skipping")
                            error_count += 1
                            continue

                        if not row.get('TeacherMarks'):
                            print(f"⚠️  Row {row_num}: Missing teacher marks, skipping")
                            error_count += 1
                            continue

                        # Parse marks and confidence
                        try:
                            teacher_marks = int(float(row['TeacherMarks']))
                            confidence = int(float(row['Confidence']))
                        except (ValueError, KeyError):
                            print(f"⚠️  Row {row_num}: Invalid marks/confidence, skipping")
                            error_count += 1
                            continue

                        if confidence > 100:
                            confidence = 100
                        if confidence < 0:
                            confidence = 0

                        # Extract question analysis
                        question_analysis = extract_question_analysis(row)

                        # Build user message
                        user_message = f"""Grade this student answer script:

Subject: {row.get('Subject', 'Unknown')}
Grade Level: {row.get('Grade', 'Unknown')}
Exam: {row.get('Exam', 'Unknown')}
Max Marks: {row.get('MaxMarks', '100')}

Student ID: {row.get('Student', 'Unknown')}

Student's Answer:
{row['StudentAnswer'].strip()}

---
Grade this according to your expert judgment and your training."""

                        # Build assistant message (the correct answer)
                        assistant_message = json.dumps({
                            "total_marks": teacher_marks,
                            "confidence_score": confidence,
                            "feedback": row.get('Feedback', 'Good work').strip(),
                            "question_analysis": question_analysis
                        }, ensure_ascii=False)

                        # Create training example
                        training_example = {
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": user_message},
                                {"role": "assistant", "content": assistant_message}
                            ]
                        }

                        # Write JSONL line
                        f_out.write(json.dumps(training_example, ensure_ascii=False) + '\n')
                        converted_count += 1

                        if converted_count % 10 == 0:
                            print(f"  Processing... {converted_count} examples converted")

                    except Exception as e:
                        print(f"⚠️  Row {row_num}: Error - {str(e)}")
                        error_count += 1
                        continue

        # Summary
        print(f"\n{'='*60}")
        print(f"✅ Conversion Complete!")
        print(f"{'='*60}")
        print(f"✅ Converted:     {converted_count} examples")
        print(f"⚠️  Errors:        {error_count} rows skipped")
        print(f"📁 Output file:   {output_file}")
        print(f"📊 File size:     {os.path.getsize(output_file) / 1024:.1f} KB")
        print(f"\nNext steps:")
        print(f"1. Verify output file looks correct")
        print(f"2. Upload to OpenAI: openai api files.create -f {output_file}")
        print(f"3. Fine-tune: openai api fine_tuning.jobs.create -m gpt-4o -f file-id")
        return True

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python prepare_finetuning_data.py <input.csv> [output.jsonl]")
        print("\nExample:")
        print("  python prepare_finetuning_data.py training_data.csv training_data.jsonl")
        sys.exit(1)

    csv_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else csv_file.replace('.csv', '.jsonl')

    print(f"📖 Converting {csv_file} → {output_file}")
    print(f"{'='*60}")

    success = csv_to_jsonl(csv_file, output_file)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
