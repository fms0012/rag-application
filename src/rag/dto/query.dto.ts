import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RagQueryDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number = 3;

  @IsOptional()
  @IsString()
  chatModel?: string;
}

