import { Body, Controller, Get, Post } from "@nestjs/common"
import { RagService } from "./rag.service"
import { RagQueryDto } from "./dto/query.dto"

@Controller("rag")
export class RagController {
    constructor(private readonly ragService: RagService) {}

    @Get("health")
    health() {
        return { status: "ok" }
    }

    @Post("query")
    async query(@Body() body: RagQueryDto) {
        console.log(body)
        const { query, topK = 3, chatModel } = body
        return this.ragService.queryRag({ query, topK, chatModel })
    }
}
