// Messages between the playground page and its render worker.

export interface PlaygroundRequest {
  id: number;
  source: string;
}

export type PlaygroundResponse
  = | {
    id: number;
    ok: true;
    pdf: ArrayBuffer;
    pageCount: number;
    compileMs: number;
    renderMs: number;
    /** The render's layout warnings, as `diagnostics.layoutWarnings` gives them. */
    warnings: { code: string; pageNumber?: number }[];
  }
  | {
    id: number;
    ok: false;
    error: { code: string; message: string; line?: number; column?: number };
  };
