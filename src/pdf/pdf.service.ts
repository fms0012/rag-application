import { Injectable, BadRequestException } from "@nestjs/common"
import { execSync } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"
import { PrismaService } from "src/prisma.service"

@Injectable()
export class PdfService {
    constructor(private readonly prisma: PrismaService) {}
    async extractText(filePath: string, forceOcr = false): Promise<string> {
        try {
            console.log("=== PDF Processing Started ===")
            console.log("File path:", filePath)
            console.log("Force OCR:", forceOcr)

            // Validate PDF file
            await this.validatePdf(filePath)
            console.log("✓ PDF validation passed")

            if (forceOcr) {
                console.log("→ Using forced OCR mode")
                return await this.extractWithOcr(filePath)
            }

            // Try direct text extraction first
            console.log("→ Attempting direct text extraction...")
            const directText = await this.extractDirect(filePath)

            // If direct extraction has meaningful content, use it
            if (this.hasContent(directText)) {
                console.log("✓ Direct extraction successful")
                return directText
            }

            // Otherwise, fallback to OCR
            console.log("→ Direct extraction yielded minimal text, falling back to OCR...")
            const ocrText = await this.extractWithOcr(filePath)

            const result = this.hasContent(directText) ? directText : ocrText
            const usedOcr = !this.hasContent(directText)

            console.log(`✓ Extraction complete (OCR: ${usedOcr}), text length: ${result.length}`)

            // Save to database with chunking
            await this.saveToDatabase(filePath, result, usedOcr)

            return result
        } catch (error) {
            console.error("=== PDF Processing Failed ===")
            console.error("Error:", error)
            throw new BadRequestException(`Failed to process PDF: ${error}`)
        }
    }

    private async saveToDatabase(filePath: string, content: string, ocrUsed: boolean) {
        const CHUNK_SIZE = 1000

        if (content.length <= CHUNK_SIZE) {
            // Save directly if within limits
            await this.prisma.ragDocument.create({
                data: {
                    content,
                    metadata: {
                        filename: path.basename(filePath),
                        ocrUsed,
                        chunked: false,
                    },
                },
            })
            console.log("✓ Saved as single document")
        } else {
            // Split into chunks
            console.log(
                `⚠ Content too large (${content.length} chars), chunking into ${CHUNK_SIZE} char chunks...`,
            )
            const chunks = this.chunkText(content, CHUNK_SIZE)

            for (let i = 0; i < chunks.length; i++) {
                await this.prisma.ragDocument.create({
                    data: {
                        content: chunks[i],
                        metadata: {
                            filename: path.basename(filePath),
                            ocrUsed,
                            chunked: true,
                            chunkIndex: i,
                            totalChunks: chunks.length,
                        },
                    },
                })
            }
            console.log(`✓ Saved as ${chunks.length} chunks`)
        }
    }

    private chunkText(text: string, chunkSize: number): string[] {
        const chunks: string[] = []
        let start = 0

        while (start < text.length) {
            chunks.push(text.slice(start, start + chunkSize))
            start += chunkSize
        }

        return chunks
    }

    private async extractDirect(filePath: string): Promise<string> {
        try {
            // Normalize path for cross-platform compatibility
            const normalizedPath = filePath.replace(/\\/g, "/")

            console.log("Attempting direct text extraction for:", normalizedPath)

            const script = `
import pdfplumber
import sys

try:
    with pdfplumber.open("${normalizedPath}") as pdf:
        print(f"PDF has {len(pdf.pages)} pages", file=sys.stderr)
        text = ""
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            print(f"Page {i+1}: {len(page_text)} characters", file=sys.stderr)
            if page_text:
                text += f"--- Page {i+1} ---\\n{page_text}\\n\\n"
        
        if not text:
            print("WARNING: No text extracted from PDF", file=sys.stderr)
        else:
            print(f"Total text extracted: {len(text)} characters", file=sys.stderr)
        
        print(text)
except Exception as e:
    print(f"ERROR in direct extraction: {str(e)}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
`

            // Use python or python3 depending on platform
            const pythonCmd = process.platform === "win32" ? "python" : "python3"
            const result = execSync(`${pythonCmd} -c "${script.replace(/"/g, '\\"')}"`, {
                encoding: "utf-8",
                maxBuffer: 10 * 1024 * 1024,
            })

            console.log("Direct extraction result length:", result.length)
            console.log("First 200 chars:", result.substring(0, 200))

            return result.trim()
        } catch (error) {
            console.error("Direct extraction error:", error)
            if (error) {
                console.error("Python stderr:", error)
            }
            return ""
        }
    }

    //     private async extractWithOcr(filePath: string): Promise<string> {
    //         try {
    //             // Normalize path for cross-platform compatibility
    //             const normalizedPath = filePath.replace(/\\/g, "/")

    //             console.log("Starting OCR for file:", normalizedPath)

    //             const script = `
    // import pytesseract
    // from pdf2image import convert_from_path
    // import sys

    // try:
    //     print("Converting PDF to images...", file=sys.stderr)
    //     images = convert_from_path("${normalizedPath}", dpi=300)
    //     print(f"Converted {len(images)} pages", file=sys.stderr)

    //     text = ""
    //     for i, image in enumerate(images):
    //         print(f"Processing page {i+1}...", file=sys.stderr)
    //         page_text = pytesseract.image_to_string(image, lang='eng')
    //         print(f"Page {i+1} extracted {len(page_text)} characters", file=sys.stderr)
    //         if page_text.strip():
    //             text += f"--- Page {i+1} ---\\n{page_text}\\n\\n"

    //     if not text:
    //         print("WARNING: No text extracted!", file=sys.stderr)
    //     else:
    //         print(f"Total text length: {len(text)}", file=sys.stderr)

    //     print(text)
    // except Exception as e:
    //     print(f"ERROR: {str(e)}", file=sys.stderr)
    //     import traceback
    //     traceback.print_exc(file=sys.stderr)
    //     raise
    // `

    //             // Use python or python3 depending on platform
    //             const pythonCmd = process.platform === "win32" ? "python" : "python3"
    //             const result = execSync(`${pythonCmd} -c "${script.replace(/"/g, '\\"')}"`, {
    //                 encoding: "utf-8",
    //                 maxBuffer: 20 * 1024 * 1024,
    //                 timeout: 300000,
    //             })

    //             console.log("OCR completed. Result length:", result.length)

    //             if (!result || result.trim().length === 0) {
    //                 throw new Error("OCR returned empty result")
    //             }

    //             return result.trim()
    //         } catch (error) {
    //             console.error("OCR Error:", error)
    //             if (error) {
    //                 console.error("Python stderr:", error)
    //             }
    //             if (error) {
    //                 console.error("Python stdout:", error)
    //             }
    //             throw new Error(`OCR failed: ${error}`)
    //         }
    //     }

    private async extractWithOcr(filePath: string): Promise<string> {
        try {
            const normalizedPath = filePath.replace(/\\/g, "/")

            const scriptPath = path.join(process.cwd(), "src", "pdf", "scripts", "ocr_extract.py")
            const pythonCmd = process.platform === "win32" ? "python" : "python3"

            const result = execSync(`${pythonCmd} "${scriptPath}" "${normalizedPath}"`, {
                encoding: "utf-8",
                maxBuffer: 20 * 1024 * 1024,
                timeout: 300000,
            })

            return result.trim()
        } catch (error: any) {
            throw new Error(`OCR failed: ${error?.message || error}`)
        }
    }

    private async validatePdf(filePath: string): Promise<void> {
        const buffer = Buffer.alloc(4)
        const fileHandle = await fs.open(filePath, "r")
        await fileHandle.read(buffer, 0, 4, 0)
        await fileHandle.close()

        if (!buffer.toString("utf-8").startsWith("%PDF")) {
            throw new Error("Invalid PDF file")
        }
    }

    private hasContent(text: string): boolean {
        if (!text) return false
        const cleanText = text.replace(/\s+/g, "")
        const wordCount = text.trim().split(/\s+/).length
        return cleanText.length >= 50 && wordCount >= 10
    }

    async cleanup(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath)
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}
