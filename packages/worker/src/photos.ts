/**
 * Almacén de fotos.
 *
 * Hoy se usa R2 (`R2PhotoStore`). Si R2 no se puede activar en la cuenta
 * (pide registrar un método de pago aunque el uso sea gratis), basta con
 * escribir otra clase que cumpla `PhotoStore` (por ejemplo, en D1 partiendo
 * cada foto en pedazos de menos de 2 MB, o en otro servicio) y cambiarla en
 * `photoStore()` de src/index.ts. Nada más del Worker sabe dónde viven las
 * fotos.
 */

export interface StoredPhotoBody {
  body: ReadableStream;
  size: number;
}

export interface PhotoStore {
  /** `true` si ya existe (las fotos no cambian). */
  has(id: string): Promise<boolean>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<StoredPhotoBody | null>;
}

export class R2PhotoStore implements PhotoStore {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  private key(id: string): string {
    return `photos/${id}.jpg`;
  }

  async has(id: string): Promise<boolean> {
    return (await this.bucket.head(this.key(id))) !== null;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    await this.bucket.put(this.key(id), bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  }

  async get(id: string): Promise<StoredPhotoBody | null> {
    const obj = await this.bucket.get(this.key(id));
    return obj ? { body: obj.body, size: obj.size } : null;
  }
}
