import pdfplumber
import sys

if len(sys.argv) < 2:
    print("No PDF path provided", file=sys.stderr)
    sys.exit(1)

pdf_path = sys.argv[1]

try:
    with pdfplumber.open(pdf_path) as pdf:
        print(f"PDF has {len(pdf.pages)} pages", file=sys.stderr)

        text = ""

        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            print(f"Page {i+1}: {len(page_text)} characters", file=sys.stderr)

            if page_text:
                text += f"--- Page {i+1} ---\n{page_text}\n\n"

        if not text:
            print("WARNING: No text extracted from PDF", file=sys.stderr)
        else:
            print(f"Total text extracted: {len(text)} characters", file=sys.stderr)

        print(text)

except Exception as e:
    print(f"ERROR in direct extraction: {str(e)}", file=sys.stderr)
    sys.exit(1)
