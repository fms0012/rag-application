import { Type } from "class-transformer"
import { IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator"

export class RagQueryDto {
    @IsString()
    question!: string

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10)
    topK?: number = 3

    @IsOptional()
    @IsString()
    chatModel?: string

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MessageDto)
    conversationHistory?: MessageDto[]
}

export class MessageDto {
    @IsString()
    role!: "user" | "bot"

    @IsString()
    text!: string
}
