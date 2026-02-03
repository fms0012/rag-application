export interface StoredDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
  embedding: number[];
}

export class InMemoryVectorStore {
  private readonly documents: StoredDocument[] = [];

  addDocument(doc: StoredDocument) {
    this.documents.push(doc);
  }

  getDocuments(): StoredDocument[] {
    return this.documents;
  }

  /**
   * Returns the topK most similar documents to the query embedding using cosine similarity.
   */
  similaritySearch(queryEmbedding: number[], topK: number): StoredDocument[] {
    if (!this.documents.length) {
      return [];
    }

    const scored = this.documents.map((doc) => {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      return { doc, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((item) => item.doc);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const minLength = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < minLength; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

