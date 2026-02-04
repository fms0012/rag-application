import { IndexFlatL2 } from 'faiss-node';
import { StoredDocument } from './vector-store';

/**
 * FAISS-backed vector store.
 *
 * Notes:
 * - Assumes all embeddings have the same dimensionality.
 * - Keeps documents in memory; FAISS index holds only vectors.
 * - Intended for demo / small-scale use; adapt as needed for persistence.
 */
export class FaissVectorStore {
  private index: IndexFlatL2 | null = null;
  private readonly documents: StoredDocument[] = [];
  private dim: number | null = null;

  addDocument(doc: StoredDocument) {
    if (!this.dim) {
      this.dim = doc.embedding.length;
      this.index = new IndexFlatL2(this.dim);
    }

    if (!this.index || !this.dim) {
      throw new Error('FAISS index not initialized correctly.');
    }

    if (doc.embedding.length !== this.dim) {
      throw new Error(
        `Embedding dimension mismatch. Expected ${this.dim}, got ${doc.embedding.length}`,
      );
    }

    this.documents.push(doc);
    // Add a single vector to the FAISS index.
    this.index.add(doc.embedding);
  }

  getDocuments(): StoredDocument[] {
    return this.documents; 
  }

  /**
   * Returns the topK most similar documents to the query embedding using L2 distance.
   */
  similaritySearch(queryEmbedding: number[], topK: number): StoredDocument[] {
    if (!this.index || !this.dim || !this.documents.length) {
      return [];
    }

    if (queryEmbedding.length !== this.dim) {
      throw new Error(
        `Query embedding dimension mismatch. Expected ${this.dim}, got ${queryEmbedding.length}`,
      );
    }

    const k = Math.min(topK, this.documents.length);
    const result = this.index.search(queryEmbedding, k);

    const indices = result.labels;
    const docs: StoredDocument[] = [];

    for (const idx of indices) {
      if (idx >= 0 && idx < this.documents.length) {
        docs.push(this.documents[idx]);
      }
    }

    return docs;
  }
}

