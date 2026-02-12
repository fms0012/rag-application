import { Body, Controller, Get, Post } from "@nestjs/common"
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { RagService } from "./rag.service"
import { RagQueryDto } from "./dto/query.dto"

@ApiTags("RAG")
@Controller("rag")
export class RagController {
    constructor(private readonly ragService: RagService) {}

    @Get("health")
    @ApiOperation({ summary: "Check health status" })
    @ApiResponse({ status: 200, description: "Health check passed" })
    health() {
        return { status: "ok" }
    }

    @Post("query")
    @ApiOperation({ summary: "Query the RAG system" })
    @ApiResponse({ status: 201, description: "Query processed successfully" })
    async query(@Body() body: RagQueryDto) {
        const { question, topK = 3, chatModel, conversationHistory } = body
        return this.ragService.queryRag({ query: question, topK, chatModel, conversationHistory })
    }
}
