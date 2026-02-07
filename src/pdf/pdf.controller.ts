import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
    Body,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { diskStorage } from "multer"
import { extname } from "path"
import { PdfService } from "./pdf.service"

@Controller("pdf")
export class PdfController {
    constructor(private readonly pdfService: PdfService) {}

    @Post("upload")
    @UseInterceptors(
        FileInterceptor("file", {
            storage: diskStorage({
                destination: "./uploads",
                filename: (req, file, cb) => {
                    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`
                    cb(null, uniqueName)
                },
            }),
            fileFilter: (req, file, cb) => {
                if (file.mimetype !== "application/pdf") {
                    cb(new BadRequestException("Only PDF files allowed"), false)
                } else {
                    cb(null, true)
                }
            },
            limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
        }),
    )
    async uploadPdf(
        @UploadedFile() file: Express.Multer.File,
        @Body("forceOcr") forceOcr?: boolean,
    ) {
        if (!file) {
            throw new BadRequestException("No file uploaded")
        }

        try {
            const text = await this.pdfService.extractText(file, forceOcr)
            await this.pdfService.cleanup(file.path)

            return {
                success: true,
                filename: file.originalname,
                text: text,
            }
        } catch (error) {
            await this.pdfService.cleanup(file.path)
            throw error
        }
    }
}
