import pytesseract
from pdf2image import convert_from_path
import sys
import os

def extract_ocr(pdf_path):
    try:
        # Convert PDF to images
        images = convert_from_path(pdf_path, dpi=200)
        
        full_text = ""
        for i, image in enumerate(images):
            page_text = pytesseract.image_to_string(image, lang='eng')
            if page_text.strip():
                full_text += f"--- Page {i+1} ---\n{page_text}\n\n"
        
        return full_text.strip()
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ocr_extract.py <pdf_path>", file=sys.stderr)
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"Error: File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)
        
    text = extract_ocr(pdf_path)
    print(text)
