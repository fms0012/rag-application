import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common"
import { GoogleGenAI } from "@google/genai"
import { StoredDocument } from "./vector-store"
import { FaissVectorStore } from "./faiss-vector-store"
import { FirebaseDocSource } from "./firebase-doc-source"
import { PrismaClient } from "@prisma/client"

const DEFAULT_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004"
const DEFAULT_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash-lite"

/**
 * Response interface for RAG queries
 */
export interface RagQueryResponse {
    question?: string
    answer: string | null
    model?: string
    message?: string
    retrievedDocs: StoredDocument[]
    distances: number[]
    confidenceScore?: number
    lowConfidence?: boolean
    metadata?: {
        documentsUsed: number
        averageRelevance: number
    }
}

@Injectable()
export class RagService {
    private readonly logger = new Logger(RagService.name)
    private readonly ai: GoogleGenAI | null
    private readonly vectorStore = new FaissVectorStore("HNSW")
    private readonly prisma = new PrismaClient()

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

        void this.bootstrapDocuments()
    }

    private async bootstrapDocuments() {
        try {
            const sourceType = process.env.RAG_SOURCE_TYPE || "firebase"
            let docs: StoredDocument[]

            if (sourceType === "mysql" || sourceType === "prisma") {
                const records = await this.prisma.ragDocument.findMany()
                docs = records.map(doc => ({
                    id: doc.id.toString(),
                    text: doc.content,
                    embedding: doc.embedding as number[],
                    metadata: doc.metadata as Record<string, unknown>,
                }))
            } else {
                const fbSource = new FirebaseDocSource({
                    collectionPath: process.env.FIREBASE_RAG_COLLECTION_PATH ?? "Retrievers",
                    textField: process.env.FIREBASE_RAG_TEXT_FIELD ?? "retriever_description",
                    metadataFields: (
                        process.env.FIREBASE_RAG_METADATA_FIELDS ?? "retriever_name,document"
                    )
                        .split(",")
                        .map(f => f.trim()),
                })
                docs = await fbSource.loadDocuments()
            }

            if (!docs.length) {
                this.logger.warn(
                    `No documents loaded from source "${sourceType}". RAG will have no external knowledge until documents are added.`,
                )
                return
            }

            // Use batch addition for better performance
            this.vectorStore.addDocuments(docs)

            this.logger.log(`Bootstrapped ${docs.length} documents into the FAISS vector store.`)
        } catch (error) {
            this.logger.error(
                "Failed to bootstrap documents; RAG will fall back to empty index.",
                error as Error,
            )
        }
    }

    async queryRag(params: {
        query: string
        topK: number
        chatModel?: string
        conversationHistory?: Array<{ role: "user" | "bot"; text: string }>
    }): Promise<RagQueryResponse> {
        const { query, topK, chatModel, conversationHistory } = params

        const MAX_HISTORY_TURNS = 5
        const recentHistory = (conversationHistory || []).slice(-MAX_HISTORY_TURNS * 2)

        if (!this.ai) {
            throw new Error("Gemini not configured")
        }

        // STEP 1 — Rewrite query into standalone question
        const standaloneQuery = await this.rewriteQueryWithHistory(query, recentHistory)

        // STEP 2 — Hybrid embedding (includes history context)
        const embeddingInput = this.buildEmbeddingContext(standaloneQuery, recentHistory)
        const queryEmbedding = await this.embedText(embeddingInput)

        // STEP 3 — Retrieve documents
        const { documents: retrievedDocs, distances } = this.vectorStore.similaritySearch(
            queryEmbedding,
            topK,
        )

        if (!retrievedDocs.length) {
            return {
                answer: "I don't have any information available in my knowledge base yet.",
                retrievedDocs: [],
                distances: [],
            }
        }

        // STEP 4 — Dynamic relevance filtering
        const threshold = this.calculateDynamicThreshold(distances)

        const relevantIndices = distances
            .map((d, i) => ({ d, i }))
            .filter(item => item.d <= threshold)
            .map(item => item.i)

        const relevantDocs = relevantIndices.map(i => retrievedDocs[i])
        const relevantDistances = relevantIndices.map(i => distances[i])

        if (!relevantDocs.length) {
            return {
                question: query,
                answer: "I couldn't find relevant information in my knowledge base.",
                retrievedDocs: [],
                distances: [],
                lowConfidence: true,
            }
        }

        // STEP 5 — Build context string
        const contextString = relevantDocs
            .map((doc, i) => `[Doc ${i + 1}]\n${doc.text}`)
            .join("\n\n---\n\n")

        // STEP 6 — Summarize conversation history
        const historySummary = await this.summarizeHistory(recentHistory)

        // STEP 7 — Build final prompt
        const systemPrompt = `You are a conversational RAG assistant.
            RULES:
                - ONLY use the provided context.
                - If answer is not in context, say you don't know instead of hallucinating.
                - Do not hallucinate.
                - Answer conversationally.

            CONTEXT:
                ${contextString}`

        const userPrompt = `Conversation summary:
            ${historySummary}
            User question:
            ${query}`


        const contents = [
            {
                role: "user" as const,
                parts: [{ text: userPrompt }],
            },
        ]

        // STEP 8 — Generate answer
        const response = await this.ai.models.generateContent({
            model: chatModel || DEFAULT_CHAT_MODEL,
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.2,
                topP: 0.8,
                maxOutputTokens: 2048,
            },
            contents,
        })

        const answer = response.text ?? ""

        // ✅ STEP 9 — Confidence scoring
        const confidenceScore = this.assessAnswerConfidence(answer, relevantDocs)

        return {
            question: query,
            answer,
            retrievedDocs: relevantDocs,
            distances: relevantDistances,
            confidenceScore,
            metadata: {
                documentsUsed: relevantDocs.length,
                averageRelevance: this.calculateAverageRelevance(relevantDistances),
            },
        }
    }

    async rewriteQueryWithHistory(
        query: string,
        history: Array<{ role: string; text: string }>,
    ): Promise<string> {
        if (!history?.length) return query

        const historyText = history.map(m => `${m.role}: ${m.text}`).join("\n")

        const prompt = `Replace the user's latest question into a standalone question.

            Conversation:${historyText}
            Latest question:${query}
            Standalone question:
        `

        const response = await this.ai?.models.generateContent({
            model: DEFAULT_CHAT_MODEL,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        })

        return response?.text?.trim() || query
    }

    buildEmbeddingContext(query: string, history: any[]) {
        if (!history?.length) return query

        const historyText = history
            .slice(-4)
            .map(m => m.text)
            .join("\n")

        return `Current question: ${query}
                Recent discussion: ${historyText}`
    }

    async summarizeHistory(history: any[]) {
        if (!history?.length) return "No prior conversation."

        const text = history.map(m => `${m.role}: ${m.text}`).join("\n")

        const prompt = `Summarize this conversation briefly for context: ${text}`

        const response = await this.ai?.models.generateContent({
            model: DEFAULT_CHAT_MODEL,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        })

        return response?.text ?? ""
    }

    /**
     * Calculate dynamic relevance threshold based on distance distribution
     */
    private calculateDynamicThreshold(distances: number[]): number {
        if (distances.length === 0) return Infinity
        if (distances.length === 1) return distances[0] + 0.1

        // Use median + standard deviation for threshold
        const sorted = [...distances].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        const mean = distances.reduce((sum, d) => sum + d, 0) / distances.length
        const variance =
            distances.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / distances.length
        const stdDev = Math.sqrt(variance)

        // Threshold: median + 1.5 * standard deviation
        // This filters out documents that are significantly less relevant
        return median + 1.5 * stdDev
    }

    /**
     * Convert distance to relevance percentage (0-100)
     */
    private getRelevanceScore(distance: number): number {
        // For L2 distance: lower is better
        // Convert to 0-100 scale (simple exponential decay)
        const score = Math.max(0, 100 * Math.exp(-distance / 2))
        return Math.round(score)
    }

    /**
     * Calculate average relevance of retrieved documents
     */
    private calculateAverageRelevance(distances: number[]): number {
        if (distances.length === 0) return 0
        const scores = distances.map(d => this.getRelevanceScore(d))
        const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length
        return Math.round(avg)
    }

    /**
     * Assess how confident we are in the answer by checking if it references context
     */
    private assessAnswerConfidence(answer: string, documents: StoredDocument[]): number {
        if (
            answer.toLowerCase().includes("i don't have") ||
            answer.toLowerCase().includes("i'm not sure") ||
            answer.toLowerCase().includes("i don't know")
        ) {
            return 30 // Low confidence
        }

        // Check if answer contains terms from the documents
        let matchScore = 0
        const answerLower = answer.toLowerCase()

        for (const doc of documents) {
            const docWords = doc.text
                .toLowerCase()
                .split(/\s+/)
                .filter(w => w.length > 4) // Only significant words
            const matches = docWords.filter(word => answerLower.includes(word))
            matchScore += matches.length
        }

        // Normalize to 0-100
        const confidence = Math.min(100, 50 + matchScore * 2)
        return Math.round(confidence)
    }

    async embedText(text: string): Promise<number[]> {
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
