import { IndexFlatL2, Index, MetricType } from "faiss-node"
import { StoredDocument } from "./vector-store"

/**
 * FAISS-backed vector store with performance optimizations.
 *
 * Improvements:
 * - Batch addition support for better performance
 * - Index persistence (save/load)
 * - Configurable index types (Flat, HNSW, IVF)
 * - Document removal capability
 * - Serialization support
 */
export class FaissVectorStore {
    private index: Index | null = null
    private readonly documents: StoredDocument[] = []
    private dim: number | null = null
    private readonly indexType: "Flat" | "HNSW" | "IVF"

    constructor(indexType: "Flat" | "HNSW" | "IVF" = "Flat") {
        this.indexType = indexType
    }

    private initializeIndex(dimension: number) {
        this.dim = dimension

        console.log("Index type:", this.indexType)
        switch (this.indexType) {
            case "HNSW":
                // HNSW is great for high-dimensional data and approximate search
                this.index = Index.fromFactory(dimension, "HNSW32,Flat", MetricType.METRIC_L2)
                break
            case "IVF":
                // IVF is good for large datasets (needs training)
                this.index = Index.fromFactory(dimension, "IVF100,Flat", MetricType.METRIC_L2)
                break
            case "Flat":
            default:
                this.index = new IndexFlatL2(dimension)
                break
        }
    }

    addDocument(doc: StoredDocument) {
        // console.log("Adding document:", doc)
        if (!this.dim) {
            this.initializeIndex(doc.embedding.length)
        }

        if (!this.index || !this.dim) {
            throw new Error("FAISS index not initialized correctly.")
        }

        if (doc.embedding.length !== this.dim) {
            throw new Error(
                `Embedding dimension mismatch. Expected ${this.dim}, got ${doc.embedding.length}`,
            )
        }

        this.documents.push(doc)
        this.index.add(doc.embedding)
    }

    /**
     * Add multiple documents in batch for better performance.
     * This is significantly faster than adding documents one by one.
     */
    addDocuments(docs: StoredDocument[]) {
        if (docs.length === 0) return

        if (!this.dim) {
            this.initializeIndex(docs[0].embedding.length)
        }

        if (!this.index || !this.dim) {
            throw new Error("FAISS index not initialized correctly.")
        }

        // Validate all embeddings
        for (const doc of docs) {
            if (doc.embedding.length !== this.dim) {
                throw new Error(
                    `Embedding dimension mismatch. Expected ${this.dim}, got ${doc.embedding.length}`,
                )
            }
        }

        // Flatten embeddings into a single array for batch addition
        const flatEmbeddings = docs.flatMap(doc => doc.embedding)

        // Add all documents to storage
        this.documents.push(...docs)

        // Batch add to FAISS index
        this.index.add(flatEmbeddings)
    }

    /**
     * Train the index if using IVF or other index types that require training.
     * Call this after adding initial documents but before searching.
     */
    train(trainingVectors?: number[]) {
        if (!this.index) {
            throw new Error("Index not initialized.")
        }

        if (this.index.isTrained()) {
            return // Already trained
        }

        if (trainingVectors) {
            this.index.train(trainingVectors)
        } else if (this.documents.length > 0) {
            // Use existing documents for training
            const flatEmbeddings = this.documents.flatMap(doc => doc.embedding)
            this.index.train(flatEmbeddings)
        } else {
            throw new Error(
                "No training data available. Add documents first or provide training vectors.",
            )
        }
    }

    /**
     * Remove documents by their indices.
     * Returns the number of documents removed.
     */
    removeDocuments(indices: number[]): number {
        if (!this.index || indices.length === 0) {
            return 0
        }

        // Remove from FAISS index
        const removedCount = this.index.removeIds(indices)

        // Remove from documents array (in reverse order to maintain indices)
        const sortedIndices = [...indices].sort((a, b) => b - a)
        for (const idx of sortedIndices) {
            if (idx >= 0 && idx < this.documents.length) {
                this.documents.splice(idx, 1)
            }
        }

        return removedCount
    }

    getDocuments(): StoredDocument[] {
        return this.documents
    }

    /**
     * Get the number of documents in the store.
     */
    ntotal(): number {
        return this.index?.ntotal() ?? 0
    }

    /**
     * Returns the topK most similar documents to the query embedding using L2 distance.
     * Also returns distances for better filtering/ranking.
     */
    similaritySearch(
        queryEmbedding: number[],
        topK: number,
    ): { documents: StoredDocument[]; distances: number[] } {
        if (!this.index || !this.dim || !this.documents.length) {
            return { documents: [], distances: [] }
        }

        if (queryEmbedding.length !== this.dim) {
            throw new Error(
                `Query embedding dimension mismatch. Expected ${this.dim}, got ${queryEmbedding.length}`,
            )
        }

        const k = Math.min(topK, this.documents.length)
        const result = this.index.search(queryEmbedding, k)

        const indices = result.labels
        const distances = result.distances
        const docs: StoredDocument[] = []

        for (const idx of indices) {
            if (idx >= 0 && idx < this.documents.length) {
                docs.push(this.documents[idx])
            }
        }

        return { documents: docs, distances }
    }

    /**
     * Save the index to a file.
     */
    async save(filepath: string) {
        if (!this.index) {
            throw new Error("No index to save.")
        }
        this.index.write(filepath)
    }

    /**
     * Load an index from a file.
     * Note: You'll need to restore the documents separately.
     */
    static async load(
        filepath: string,
        indexType: "Flat" | "HNSW" | "IVF" = "Flat",
    ): Promise<FaissVectorStore> {
        const store = new FaissVectorStore(indexType)

        if (indexType === "Flat") {
            store.index = IndexFlatL2.read(filepath)
        } else {
            store.index = Index.read(filepath)
        }

        store.dim = store.index.getDimension()
        return store
    }

    /**
     * Serialize the index to a buffer for in-memory storage/transfer.
     */
    toBuffer(): Buffer {
        if (!this.index) {
            throw new Error("No index to serialize.")
        }
        return this.index.toBuffer()
    }

    /**
     * Deserialize an index from a buffer.
     */
    static fromBuffer(
        buffer: Buffer,
        indexType: "Flat" | "HNSW" | "IVF" = "Flat",
    ): FaissVectorStore {
        const store = new FaissVectorStore(indexType)
        store.index = Index.fromBuffer(buffer)
        store.dim = store.index.getDimension()
        return store
    }

    /**
     * Merge another vector store into this one.
     */
    mergeFrom(other: FaissVectorStore) {
        if (!this.index || !other.index) {
            throw new Error("Cannot merge uninitialized indices.")
        }

        if (this.dim !== other.dim) {
            throw new Error("Cannot merge indices with different dimensions.")
        }

        this.index.mergeFrom(other.index)
        this.documents.push(...other.documents)
    }
}
