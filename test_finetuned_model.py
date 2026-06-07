#!/usr/bin/env python3
"""
MarkNex Fine-tuned Model Testing Script

Test and compare your fine-tuned GPT-4o model against the original.
Usage: python test_finetuned_model.py --finetuned gpt-4o-2024-06-05-ft-xxx [--compare]
"""

import json
import sys
import time
import os
from typing import Dict, Any
from openai import OpenAI

# Initialize OpenAI client
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("❌ Error: OPENAI_API_KEY environment variable not set")
    sys.exit(1)

client = OpenAI(api_key=api_key)

# Sample test scripts
TEST_SCRIPTS = [
    {
        "subject": "Mathematics",
        "grade": "Grade 10",
        "exam": "Final Exam Term 1",
        "max_marks": 100,
        "content": """Question 1: Solve 2x + 5 = 15
Solution: 2x = 15 - 5 = 10
x = 5
✓ Correct

Question 2: Find area of circle with radius 5cm
Solution: A = πr² = π(5)² = 25π ≈ 78.54 cm²
✓ Correct

Question 3: Solve quadratic x² - 5x + 6 = 0
Solution: (x-2)(x-3) = 0
x = 2 or x = 3
✓ Correct but missing factorization method explanation

Question 4: Calculate compound interest
P = $1000, r = 5%, t = 2 years
A = P(1 + r)^t = 1000(1.05)² = $1102.50
✓ Correct calculation, good explanation

Question 5: Simplify √72
√72 = √(36 × 2) = 6√2
✓ Correct with working shown"""
    },
    {
        "subject": "English Literature",
        "grade": "Grade 11",
        "exam": "Midterm Exam",
        "max_marks": 80,
        "content": """Essay: Discuss the theme of ambition in Macbeth

Macbeth is a tragic character whose ambition drives him to commit terrible acts. The witches' prophecy awakens his dormant desires for power, and Lady Macbeth's manipulation pushes him further. His ambition leads him to murder Duncan, betray Banquo, and massacre Macduff's family.

The turning point comes when Macbeth realizes that power means nothing without security. "I have no son," he laments, showing that his ambition has cost him everything. The play suggests that unchecked ambition is destructive and corrupting.

Shakespeare uses vivid imagery and soliloquies to show Macbeth's internal struggle. The dagger soliloquy reveals his state of mind before murdering Duncan. By the end, Macbeth becomes a hollow figure, having achieved power but lost his humanity.

In conclusion, Shakespeare demonstrates that ambition, while a natural human desire, becomes dangerous when pursued without moral restraint. Macbeth's tragedy serves as a cautionary tale."""
    },
    {
        "subject": "Physics",
        "grade": "Grade 9",
        "exam": "Unit Test - Forces",
        "max_marks": 50,
        "content": """Q1: What is Newton's Second Law?
Answer: F = ma (Force equals mass times acceleration)
The law states that the force applied to an object is equal to the mass times its acceleration.
✓ Correct definition

Q2: Calculate the acceleration of a 5kg object with 20N force
F = ma
20 = 5 × a
a = 20/5 = 4 m/s²
✓ Correct - good step-by-step working

Q3: Define momentum and give its unit
Momentum (p) = m × v (mass × velocity)
Unit: kg⋅m/s or kg m/s
✓ Correct

Q4: A car of mass 1000kg accelerates from 0 to 20 m/s in 5 seconds
Find: (a) acceleration, (b) force
(a) v = u + at, 20 = 0 + a(5), a = 4 m/s²
(b) F = ma = 1000 × 4 = 4000 N
✓ Correct methodology, minor unit notation"""
    }
]

def grade_script(model_id: str, script: Dict[str, str]) -> Dict[str, Any]:
    """Grade a single script using specified model"""

    system_prompt = """You are an expert teacher grading student answer scripts. Grade fairly and provide constructive feedback.

Output MUST be valid JSON with:
- total_marks: integer score (0-100)
- confidence_score: your confidence (0-100)
- feedback: constructive feedback
- question_analysis: array of question-level analysis"""

    user_message = f"""Grade this student answer:

Subject: {script['subject']}
Grade Level: {script['grade']}
Exam: {script['exam']}
Max Marks: {script['max_marks']}

Student's Answer:
{script['content']}"""

    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            max_tokens=1000,
            response_format={"type": "json_object"},
            temperature=0.7
        )

        result_text = response.choices[0].message.content
        result = json.loads(result_text)

        return {
            "success": True,
            "model": model_id,
            "marks": result.get("total_marks"),
            "confidence": result.get("confidence_score"),
            "feedback": result.get("feedback"),
            "analysis": result.get("question_analysis", []),
            "raw": result
        }

    except json.JSONDecodeError as e:
        return {
            "success": False,
            "model": model_id,
            "error": f"JSON parsing error: {str(e)}",
            "raw_response": result_text
        }
    except Exception as e:
        return {
            "success": False,
            "model": model_id,
            "error": str(e)
        }

def test_single_model(model_id: str) -> Dict[str, Any]:
    """Test a single model against all test scripts"""

    print(f"\n{'='*70}")
    print(f"Testing Model: {model_id}")
    print(f"{'='*70}")

    results = {
        "model": model_id,
        "test_count": len(TEST_SCRIPTS),
        "results": [],
        "summary": {
            "avg_marks": 0,
            "avg_confidence": 0,
            "total_time": 0
        }
    }

    total_marks = 0
    total_confidence = 0
    total_time = 0

    for idx, script in enumerate(TEST_SCRIPTS, 1):
        print(f"\n[Test {idx}/{len(TEST_SCRIPTS)}] {script['subject']} ({script['grade']})")

        start_time = time.time()
        result = grade_script(model_id, script)
        elapsed = time.time() - start_time

        if result["success"]:
            marks = result["marks"]
            confidence = result["confidence"]

            print(f"  ✅ Success")
            print(f"  📊 Marks: {marks}/{script['max_marks']}")
            print(f"  🎯 Confidence: {confidence}%")
            print(f"  ⏱️  Time: {elapsed:.2f}s")
            print(f"  💭 Feedback: {result['feedback'][:100]}...")

            total_marks += marks
            total_confidence += confidence
            total_time += elapsed

            results["results"].append({
                "subject": script["subject"],
                "marks": marks,
                "confidence": confidence,
                "time": elapsed,
                "feedback": result["feedback"]
            })
        else:
            print(f"  ❌ Error: {result['error']}")
            results["results"].append({
                "subject": script["subject"],
                "error": result["error"]
            })

    # Calculate averages
    if len(TEST_SCRIPTS) > 0:
        results["summary"]["avg_marks"] = total_marks / len(TEST_SCRIPTS)
        results["summary"]["avg_confidence"] = total_confidence / len(TEST_SCRIPTS)
        results["summary"]["total_time"] = total_time

    return results

def compare_models(original_id: str, finetuned_id: str):
    """Compare original vs fine-tuned model"""

    print(f"\n{'='*70}")
    print(f"COMPARISON: Original vs Fine-tuned")
    print(f"{'='*70}")

    # Test both models
    original_results = test_single_model(original_id)
    finetuned_results = test_single_model(finetuned_id)

    # Print comparison table
    print(f"\n{'='*70}")
    print(f"RESULTS COMPARISON")
    print(f"{'='*70}")

    print(f"\n{'Metric':<25} {'Original':<20} {'Fine-tuned':<20} {'Difference':<15}")
    print(f"{'-'*80}")

    orig_avg_marks = original_results["summary"]["avg_marks"]
    ft_avg_marks = finetuned_results["summary"]["avg_marks"]
    print(f"{'Average Marks':<25} {orig_avg_marks:<20.1f} {ft_avg_marks:<20.1f} {ft_avg_marks - orig_avg_marks:+.1f}")

    orig_avg_conf = original_results["summary"]["avg_confidence"]
    ft_avg_conf = finetuned_results["summary"]["avg_confidence"]
    print(f"{'Avg Confidence':<25} {orig_avg_conf:<20.1f}% {ft_avg_conf:<20.1f}% {ft_avg_conf - orig_avg_conf:+.1f}%")

    orig_time = original_results["summary"]["total_time"]
    ft_time = finetuned_results["summary"]["total_time"]
    print(f"{'Total Time':<25} {orig_time:<20.2f}s {ft_time:<20.2f}s {ft_time - orig_time:+.2f}s")

    # Save detailed results
    with open("comparison_results.json", "w") as f:
        json.dump({
            "original": original_results,
            "finetuned": finetuned_results
        }, f, indent=2)

    print(f"\n✅ Detailed results saved to: comparison_results.json")

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Test fine-tuned GPT-4o models")
    parser.add_argument("--finetuned", required=True, help="Fine-tuned model ID")
    parser.add_argument("--compare", action="store_true", help="Compare with original GPT-4o")
    parser.add_argument("--original", default="gpt-4o", help="Original model ID (default: gpt-4o)")

    args = parser.parse_args()

    if args.compare:
        compare_models(args.original, args.finetuned)
    else:
        results = test_single_model(args.finetuned)
        print(f"\n{'='*70}")
        print(f"SUMMARY")
        print(f"{'='*70}")
        print(f"✅ Tests completed: {results['test_count']}")
        print(f"📊 Average marks: {results['summary']['avg_marks']:.1f}")
        print(f"🎯 Average confidence: {results['summary']['avg_confidence']:.1f}%")
        print(f"⏱️  Total time: {results['summary']['total_time']:.2f}s")

if __name__ == "__main__":
    main()
