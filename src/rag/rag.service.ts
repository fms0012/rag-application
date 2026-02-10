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
    private readonly vectorStore = new FaissVectorStore("Flat")
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

        // Increase history window for better context retention
        const MAX_HISTORY_TURNS = 5
        const recentHistory = (conversationHistory || []).slice(-MAX_HISTORY_TURNS * 2)

        const queryEmbedding = await this.embedText(query)
        const { documents: retrievedDocs, distances } = this.vectorStore.similaritySearch(
            queryEmbedding,
            topK,
        )

        if (!retrievedDocs.length) {
            return {
                answer: "I don't have any information available in my knowledge base yet. Could you try asking something else or provide me with some documents to learn from?",
                message: "No documents available in the vector store.",
                retrievedDocs: [],
                distances: [],
            }
        }

        if (!this.ai) {
            return {
                answer: null,
                message:
                    "GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured. RAG retrieval works, but generation is disabled. Configure the key to enable full RAG.",
                retrievedDocs,
                distances,
            }
        }

        // Filter out low-relevance documents based on distance threshold
        // Lower distance = more similar (for L2 distance)
        const RELEVANCE_THRESHOLD = this.calculateDynamicThreshold(distances)
        const relevantIndices = distances
            .map((d, i) => ({ distance: d, index: i }))
            .filter(item => item.distance <= RELEVANCE_THRESHOLD)
            .map(item => item.index)

        const relevantDocs = relevantIndices.map(i => retrievedDocs[i])
        const relevantDistances = relevantIndices.map(i => distances[i])

        if (relevantDocs.length === 0) {
            return {
                question: query,
                answer: "I apologize, but I couldn't find relevant information in my knowledge base to answer your question confidently. Could you rephrase your question or ask about a different topic?",
                model: chatModel || DEFAULT_CHAT_MODEL,
                retrievedDocs: [],
                distances: [],
                lowConfidence: true,
            }
        }

        // Build context with relevance scores
        const contextString = relevantDocs
            .map((d, i) => {
                const relevanceScore = this.getRelevanceScore(relevantDistances[i])
                return `[Document ${i + 1} - Relevance: ${relevanceScore}%]\n${d.text}\n${
                    d.metadata ? `Metadata: ${JSON.stringify(d.metadata)}` : ""
                }`
            })
            .join("\n\n---\n\n")

        // Enhanced system prompt to reduce hallucinations and improve conversation
        const systemPrompt = `You are a friendly and helpful AI assistant. Your goal is to provide accurate, conversational responses.
            CRITICAL RULES:
            1. ONLY use information from the provided context documents below
            2. If the context doesn't contain the answer, clearly say "I don't have that information" or "I'm not sure about that based on what I know"
            3. NEVER make up or infer information that isn't explicitly in the context
            4. Be conversational and friendly, but always prioritize accuracy over being helpful
            5. If you're unsure, express uncertainty rather than guessing
            6. Reference the conversation history to maintain context and avoid repeating yourself
            7. When answering, you can synthesize information from multiple documents, but don't add external knowledge
            8. Do not answer questions that are not related to the context

            CONVERSATION STYLE:
            - Be warm and approachable
            - Use natural language, not robotic responses
            - Remember what was discussed earlier in the conversation
            - If asked a follow-up question, connect it to previous exchanges

            Remember: It's better to say "I don't know" than to provide incorrect information.`

        // Build conversation-aware prompt
        const userPrompt = this.buildConversationalPrompt(query, contextString, recentHistory)

        try {
            const modelToUse = chatModel || DEFAULT_CHAT_MODEL

            // Build the full conversation with context
            const contents = [
                // Include recent conversation history
                ...(recentHistory?.map(msg => ({
                    role: msg.role === "bot" ? ("model" as const) : ("user" as const),
                    parts: [{ text: msg.text }],
                })) ?? []),
                // Current query with context
                {
                    role: "user" as const,
                    parts: [{ text: userPrompt }],
                },
            ]

            const response = await this.ai.models.generateContent({
                model: modelToUse,
                config: {
                    systemInstruction: systemPrompt,
                    // temperature: 0.3, // Lower temperature to reduce creativity/hallucination
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 2048,
                },
                contents,
            })

            const answer = response.text ?? ""

            // Detect potential hallucination by checking if answer references context
            const confidenceScore = this.assessAnswerConfidence(answer, relevantDocs)

            return {
                question: query,
                answer,
                model: modelToUse,
                retrievedDocs: relevantDocs,
                distances: relevantDistances,
                confidenceScore,
                metadata: {
                    documentsUsed: relevantDocs.length,
                    averageRelevance: this.calculateAverageRelevance(relevantDistances),
                },
            }
        } catch (error) {
            this.logger.error("Error calling Gemini for RAG answer", error as Error)
            throw new InternalServerErrorException(
                "I apologize, but I encountered an error while processing your question. Please try again.",
            )
        }
    }

    /**
     * Build a conversational prompt that references chat history
     */
    private buildConversationalPrompt(
        query: string,
        contextString: string,
        history: Array<{ role: "user" | "bot"; text: string }>,
    ): string {
        const hasHistory = history && history.length > 0

        if (hasHistory) {
            // Check if this is a follow-up question
            const isFollowUp = this.isFollowUpQuestion(query)

            if (isFollowUp) {
                return `CONTEXT DOCUMENTS:
                        ${contextString}

                        ---

                        CURRENT QUESTION: ${query}

                        Note: This appears to be a follow-up to our previous conversation. Please consider the conversation history when answering, and reference it if relevant. Use the context documents above to answer accurately.`
            }
        }

        return `CONTEXT DOCUMENTS:
                        ${contextString}

                        ---

                        QUESTION: ${query}

                        Please answer the question above using ONLY the information from the context documents. Be friendly and conversational in your response.`
    }

    /**
     * Detect if a question is a follow-up based on pronouns and references
     */
    private isFollowUpQuestion(query: string): boolean {
        const followUpIndicators = [
            /\b(it|that|this|these|those|they|them)\b/i,
            /\b(what about|how about|tell me more)\b/i,
            /\b(also|additionally|furthermore|moreover)\b/i,
            /\b(previous|earlier|before|last)\b/i,
            /^(and|but|or|so)\b/i,
        ]

        return followUpIndicators.some(pattern => pattern.test(query))
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
