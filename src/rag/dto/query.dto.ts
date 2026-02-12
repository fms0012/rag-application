import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { Type } from "class-transformer"
import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator"

export class MessageDto {
    @ApiProperty({ description: "Role of the message sender", enum: ["user", "bot"] })
    @IsString()
    role!: "user" | "bot"

    @ApiProperty({ description: "Content of the message" })
    @IsString()
    text!: string
}

export class RagQueryDto {
    @ApiProperty({ description: "The question to ask the RAG system" })
    @IsString()
    question!: string

    @ApiPropertyOptional({ description: "Number of relevant documents to retrieve", minimum: 1, maximum: 10, default: 3 })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10)
    topK?: number = 3

    @ApiPropertyOptional({ description: "Chat model to use" })
    @IsOptional()
    @IsString()
    chatModel?: string

    @ApiPropertyOptional({ description: "Conversation history for context", type: [MessageDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MessageDto)
    conversationHistory?: MessageDto[]
}
