import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common"
import { GoogleGenAI } from "@google/genai"
import { InMemoryVectorStore, StoredDocument } from "./vector-store"

const DEFAULT_EMBEDDING_MODEL = "text-embedding-004"
const DEFAULT_CHAT_MODEL = "gemini-2.5-flash"

@Injectable()
export class RagService {
    private readonly logger = new Logger(RagService.name)
    private readonly ai: GoogleGenAI | null
    private readonly vectorStore = new InMemoryVectorStore()

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
        if (!apiKey) {
            this.logger.warn(
                "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. RAG generation will be disabled.",
            )
            this.ai = null
        } else {
            this.ai = new GoogleGenAI({ apiKey })
        }

        void this.bootstrapSampleDocuments()
    }

    private async bootstrapSampleDocuments() {
        const sampleDocs: Omit<StoredDocument, "embedding">[] = [
            {
                id: "intro-nestjs",
                text: "NestJS is a progressive Node.js framework for building efficient and scalable server-side applications.",
                metadata: { topic: "nestjs", type: "intro" },
            },
            {
                id: "intro-rag",
                text: "Retrieval-Augmented Generation (RAG) combines information retrieval with text generation models to ground responses in external knowledge.",
                metadata: { topic: "rag", type: "concept" },
            },
            {
                id: "rag-pipeline",
                text: "A basic RAG pipeline has three steps: retrieve relevant documents, construct a prompt with the retrieved context, and generate an answer with a language model.",
                metadata: { topic: "rag", type: "pipeline" },
            },
        ]

        for (const doc of sampleDocs) {
            const embedding = await this.embedText(doc.text)
            this.vectorStore.addDocument({
                ...doc,
                embedding,
            })
        }

        this.logger.log(`Bootstrapped ${sampleDocs.length} sample documents into the vector store.`)
    }

    async queryRag(params: { query: string; topK: number; chatModel?: string }) {
        const { query, topK, chatModel } = params

        const queryEmbedding = await this.embedText(query)
        const retrievedDocs = this.vectorStore.similaritySearch(queryEmbedding, topK)

        if (!retrievedDocs.length) {
            return {
                answer: null,
                message: "No documents available in the vector store.",
                retrievedDocs,
            }
        }

        if (!this.ai) {
            return {
                answer: null,
                message:
                    "GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured. RAG retrieval works, but generation is disabled. Configure the key to enable full RAG.",
                retrievedDocs,
            }
        }

        const contextString = retrievedDocs
            .map(
                (d, i) =>
                    `Document ${i + 1} (id=${d.id}):\n${d.text}\nmetadata: ${JSON.stringify(d.metadata ?? {})}`,
            )
            .join("\n\n")

        const systemPrompt = [
            "You are a helpful assistant that answers questions using ONLY the provided context.",
            "If the context is insufficient, say you are not sure instead of hallucinating.",
        ].join(" ")

        const prompt = [
            systemPrompt,
            "\n\nContext:\n",
            contextString,
            "\n\nUser question:\n",
            query,
            "\n\nUse the context above to answer the question.",
        ].join("")

        try {
            const modelToUse = chatModel || DEFAULT_CHAT_MODEL
            const response = await this.ai.models.generateContent({
                model: modelToUse,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
            })

            const answer = response.text ?? ""

            return {
                answer,
                model: modelToUse,
                retrievedDocs,
            }
        } catch (error) {
            this.logger.error("Error calling Gemini for RAG answer", error as Error)
            throw new InternalServerErrorException("Failed to generate answer from Gemini")
        }
    }

    private async embedText(text: string): Promise<number[]> {
        if (!this.ai) {
            // Fallback: deterministic pseudo-embedding if Gemini is not configured.
            // This keeps retrieval logic working for experimentation.
            return this.simpleHashEmbedding(text, 256)
        }

        const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL

        try {
            const response = await this.ai.models.embedContent({
                model: embeddingModel,
                contents: text,
            })

            const vector = response.embeddings?.[0]?.values ?? []
            return vector
        } catch (error) {
            this.logger.error(
                "Error creating embedding with Gemini, falling back to simple hash embedding",
                error as Error,
            )
            return this.simpleHashEmbedding(text, 256)
        }
    }

    private simpleHashEmbedding(text: string, dim: number): number[] {
        const vector = new Array<number>(dim).fill(0)
        for (let i = 0; i < text.length; i += 1) {
            const charCode = text.charCodeAt(i)
            const idx = charCode % dim
            vector[idx] += 1
        }
        const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
        if (norm === 0) {
            return vector
        }
        return vector.map(v => v / norm)
    }
}
